import { readFile, lstat } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { objectKey, ObjectPathSchema, resolvePlaylistReference } from "@/lib/r2/paths";
import { parallelMap } from "@/lib/r2/ObjectStore";
import {
  ZivoraMediaDescriptorSchema,
  ValidationCheckNameSchema,
  type ZivoraMediaDescriptor,
} from "@/pipeline/validation/MediaValidator";
import {
  parseManifest,
  type MediaPlaylist,
  type MasterPlaylist,
} from "@/pipeline/validation/ManifestValidator";
import { parseWebVtt } from "@/pipeline/media/subtitles";
import {
  SubtitleAttributesSchema,
  parseWebVtt as parseCaptionWebVtt,
} from "@/features/subtitles/vtt";
import { ABR_LADDER } from "@/pipeline/media/encode";
import type { TablesInsert } from "@/lib/supabase/types";
import { AllocatedVersionSchema, VersionManager, type AllocatedVersion } from "./VersionManager";
import { R2Uploader, sha256, UploadAssetSchema, type UploadAsset } from "./R2Uploader";
import { validateFmp4 } from "./Fmp4Validator";

export interface MediaRegistration {
  checksums: Record<string, string>;
  manifests: Omit<TablesInsert<"manifests">, "media_version_id">[];
  renditions: Omit<TablesInsert<"renditions">, "media_version_id">[];
  audio_tracks: Omit<TablesInsert<"audio_tracks">, "media_version_id">[];
  subtitle_tracks: Omit<TablesInsert<"subtitle_tracks">, "media_version_id">[];
  thumbnails: Omit<TablesInsert<"thumbnails">, "media_version_id">[];
}
export interface PublicationRepository {
  register(versionId: string, media: MediaRegistration): Promise<void>;
  markReady(versionId: string): Promise<void>;
  publish(versionId: string): Promise<string>;
  fail(versionId: string): Promise<void>;
  rollback(parentId: string): Promise<string>;
}
export interface PublicationProgressHooks {
  uploaded?: () => Promise<void>;
  cloudValidated?: () => Promise<void>;
  playbackTested?: () => Promise<void>;
  registered?: () => Promise<void>;
  published?: () => Promise<void>;
}
interface CloudPackage {
  master: MasterPlaylist;
  children: { path: string; kind: "VIDEO" | "AUDIO" | "SUBTITLE"; playlist: MediaPlaylist }[];
}

export async function loadPublicationPackage(
  directory: string,
): Promise<{ descriptor: ZivoraMediaDescriptor; assets: UploadAsset[] }> {
  const path = join(directory, "zivora-media.json");
  const info = await lstat(path);
  if (!info.isFile() || info.size > 16 * 1024 * 1024)
    throw new Error("Invalid media descriptor file");
  const bytes = await readFile(path);
  const descriptor = ZivoraMediaDescriptorSchema.parse(JSON.parse(bytes.toString("utf8")));
  const expectedChecks = ValidationCheckNameSchema.options;
  if (
    descriptor.validation.checks.length !== expectedChecks.length ||
    descriptor.validation.checks.some(
      (check, i) => check.name !== expectedChecks[i] || check.status !== "passed",
    )
  )
    throw new Error("Local media validation is incomplete or failed");
  const assets = z.array(UploadAssetSchema).min(1).max(99999).parse(descriptor.assets);
  if (
    assets.some((asset) => asset.path === "zivora-media.json") ||
    new Set(assets.map((asset) => asset.path)).size !== assets.length
  )
    throw new Error("Descriptor contains duplicate/self-referential assets");
  assets.push({ path: "zivora-media.json", size: bytes.length, sha256: sha256(bytes) });
  for (const required of [
    descriptor.masterPlaylist,
    descriptor.thumbnailVtt,
    ...descriptor.renditions.map((r) => r.playlist),
    ...descriptor.audioTracks.map((t) => t.playlist),
    ...descriptor.subtitleTracks.map((t) => t.playlist),
  ]) {
    ObjectPathSchema.parse(required);
    if (!assets.some((a) => a.path === required))
      throw new Error(`Missing descriptor asset: ${required}`);
  }
  return { descriptor, assets };
}

export async function validateCloudPackage(
  uploader: R2Uploader,
  version: AllocatedVersion,
  descriptor: ZivoraMediaDescriptor,
  assets: UploadAsset[],
): Promise<CloudPackage> {
  await parallelMap(assets, 4, (asset) => uploader.verify(version.prefix, asset));
  const byPath = new Map(assets.map((asset) => [asset.path, asset]));
  const requireAsset = (path: string) => {
    const asset = byPath.get(ObjectPathSchema.parse(path));
    if (!asset) throw new Error(`Manifest references an unregistered asset: ${path}`);
    return asset;
  };
  const read = async (path: string) => {
    const asset = requireAsset(path);
    const bytes = await uploader.store.get(objectKey(version.prefix, path), asset.size);
    if (sha256(bytes) !== asset.sha256) throw new Error(`Remote asset checksum mismatch: ${path}`);
    return bytes;
  };
  const readPlaylist = async (path: string) => {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(await read(path));
    if (/^#EXT-X-(?:KEY|SESSION-KEY|DISCONTINUITY)(?::|$)/m.test(text))
      throw new Error("Unexpected encrypted/discontinuous packaging");
    return parseManifest(text);
  };
  const master = await readPlaylist(descriptor.masterPlaylist);
  if (master.kind !== "master" || !master.independentSegments || master.variants.length !== 4)
    throw new Error("Invalid remote ABR master");
  if (
    master.variants.some(
      (variant) =>
        !variant.codecs.some((codec) => /^avc1\./.test(codec)) ||
        !variant.codecs.includes("mp4a.40.2") ||
        variant.codecs.some((codec) => !/^avc1\./.test(codec) && codec !== "mp4a.40.2"),
    )
  )
    throw new Error("Remote codecs must be H.264/AAC");
  const children: CloudPackage["children"] = [];
  const references = [
    ...master.variants.map((v) => ({ uri: v.uri, kind: "VIDEO" as const })),
    ...master.media.map((t) => ({
      uri: t.uri,
      kind: t.type === "AUDIO" ? ("AUDIO" as const) : ("SUBTITLE" as const),
    })),
  ];
  if (new Set(references.map((r) => r.uri)).size !== references.length)
    throw new Error("Duplicate child playlist reference");
  for (const reference of references) {
    const path = resolvePlaylistReference(descriptor.masterPlaylist, reference.uri);
    const playlist = await readPlaylist(path);
    if (playlist.kind !== "media" || !playlist.endList || playlist.playlistType !== "VOD")
      throw new Error("Remote playlist must be finite VOD");
    if (playlist.segments.some((s) => s.byteRange !== null))
      throw new Error("Byte-range playlists are outside the frozen packaging format");
    const total = playlist.segments.reduce((sum, s) => sum + s.duration, 0);
    if (Math.abs(total - descriptor.durationSeconds) / descriptor.durationSeconds > 0.01)
      throw new Error(`Remote duration mismatch: ${path}`);
    if (reference.kind !== "SUBTITLE") {
      if (
        !playlist.initSegmentUri ||
        !playlist.initSegmentUri.endsWith(".mp4") ||
        playlist.segments.some((s) => !s.uri.endsWith(".m4s"))
      )
        throw new Error("Remote playlist is not CMAF");
      requireAsset(resolvePlaylistReference(path, playlist.initSegmentUri));
    }
    for (const segment of playlist.segments) {
      const assetPath = resolvePlaylistReference(path, segment.uri);
      requireAsset(assetPath);
      if (reference.kind === "SUBTITLE") {
        if (!assetPath.endsWith(".vtt")) throw new Error("Subtitle must be WebVTT");
        const cues = parseCaptionWebVtt(new TextDecoder().decode(await read(assetPath)));
        if (!cues.length || cues.some((c) => c.end > descriptor.durationSeconds * 1.01))
          throw new Error("Invalid remote subtitles");
      }
    }
    children.push({ path, kind: reference.kind, playlist });
  }
  for (const ladder of ABR_LADDER) {
    const variants = master.variants.filter(
      (v) => v.resolution.height === ladder.height && v.resolution.width === ladder.width,
    );
    const described = descriptor.renditions.find((r) => r.id === ladder.id);
    if (
      variants.length !== 1 ||
      !described ||
      described.playlist !== resolvePlaylistReference(descriptor.masterPlaylist, variants[0].uri) ||
      described.bandwidth !== variants[0].bandwidth
    )
      throw new Error("Remote rendition differs from the descriptor");
  }
  for (const [type, described] of [
    ["AUDIO", descriptor.audioTracks],
    ["SUBTITLES", descriptor.subtitleTracks],
  ] as const) {
    const tracks = master.media.filter((t) => t.type === type);
    if (type === "SUBTITLES")
      for (const track of tracks) {
        const attributes = SubtitleAttributesSchema.parse(track.attributes);
        const item = descriptor.subtitleTracks.find(
          (d) => d.playlist === resolvePlaylistReference(descriptor.masterPlaylist, track.uri),
        );
        if (
          item &&
          ((item.kind !== undefined && item.kind !== (attributes["X-ZIVORA-KIND"] ?? "original")) ||
            (item.hasSpeakerNames !== undefined &&
              item.hasSpeakerNames !== (attributes["X-ZIVORA-SPEAKERS"] === "YES")) ||
            (item.hasContextHints !== undefined &&
              item.hasContextHints !== (attributes["X-ZIVORA-HINTS"] === "YES")))
        )
          throw new Error("Remote subtitle enrichment metadata mismatch");
      }
    if (
      tracks.length !== described.length ||
      (type === "AUDIO" && (!tracks.length || tracks.filter((t) => t.default).length !== 1))
    )
      throw new Error("Remote track inventory mismatch");
    for (const track of tracks)
      if (
        !described.some(
          (d) =>
            d.playlist === resolvePlaylistReference(descriptor.masterPlaylist, track.uri) &&
            d.language === track.language &&
            d.name === track.name,
        )
      )
        throw new Error("Remote track metadata mismatch");
  }
  const cues = parseWebVtt(new TextDecoder().decode(await read(descriptor.thumbnailVtt)));
  if (cues.length !== Math.ceil(descriptor.durationSeconds / 5))
    throw new Error("Invalid remote thumbnail coverage");
  for (const [index, cue] of cues.entries()) {
    const match = /^([^#]+\.jpg)#xywh=(\d+),(\d+),320,180$/.exec(cue.text);
    if (
      !match ||
      Math.abs(cue.start - index * 5) > 0.001 ||
      Math.abs(cue.end - Math.min(descriptor.durationSeconds, index * 5 + 5)) > 0.001 ||
      Number(match[2]) !== (index % 10) * 320 ||
      Number(match[3]) !== Math.floor((index % 100) / 10) * 180
    )
      throw new Error("Invalid thumbnail timing or coordinates");
    const spritePath = resolvePlaylistReference(descriptor.thumbnailVtt, match[1]);
    if (
      spritePath !==
      `thumbnails/sprites/sprite-${String(Math.floor(index / 100) + 1).padStart(4, "0")}.jpg`
    )
      throw new Error("Invalid thumbnail sprite sequence");
    requireAsset(spritePath);
  }
  return { master, children };
}

export async function samplePlayback(
  uploader: R2Uploader,
  version: AllocatedVersion,
  cloud: CloudPackage,
): Promise<void> {
  for (const child of cloud.children.filter((c) => c.kind !== "SUBTITLE")) {
    const init = resolvePlaylistReference(child.path, child.playlist.initSegmentUri!);
    validateFmp4(await uploader.store.get(objectKey(version.prefix, init)), "init");
    const segments = child.playlist.segments;
    for (const uri of new Set([segments[0].uri, segments[segments.length - 1].uri])) {
      validateFmp4(
        await uploader.store.get(
          objectKey(version.prefix, resolvePlaylistReference(child.path, uri)),
        ),
        "segment",
      );
    }
  }
}

function registration(
  descriptor: ZivoraMediaDescriptor,
  assets: UploadAsset[],
  cloud: CloudPackage,
): MediaRegistration {
  const checksums = Object.fromEntries(assets.map((asset) => [asset.path, asset.sha256]));
  return {
    checksums,
    manifests: [
      {
        kind: "MASTER",
        path: descriptor.masterPlaylist,
        checksum_sha256: checksums[descriptor.masterPlaylist],
      },
      ...cloud.children.map((c) => ({
        kind: c.kind,
        path: c.path,
        checksum_sha256: checksums[c.path],
      })),
    ],
    renditions: ABR_LADDER.map((r) => {
      const entry = descriptor.renditions.find((d) => d.id === r.id)!;
      return {
        quality_id: r.id,
        width: r.width,
        height: r.height,
        codec: "h264",
        video_bitrate: r.videoBitrate,
        max_rate: r.maxRate,
        buffer_size: r.bufferSize,
        playlist_path: entry.playlist,
        checksum_sha256: checksums[entry.playlist],
      };
    }),
    audio_tracks: cloud.master.media
      .filter((t) => t.type === "AUDIO")
      .map((t) => {
        const path = resolvePlaylistReference(descriptor.masterPlaylist, t.uri);
        return {
          language: t.language!,
          label: t.name,
          playlist_path: path,
          checksum_sha256: checksums[path],
          is_default: t.default,
        };
      }),
    subtitle_tracks: cloud.master.media
      .filter((t) => t.type === "SUBTITLES")
      .map((t) => {
        const path = resolvePlaylistReference(descriptor.masterPlaylist, t.uri);
        return {
          kind: z
            .enum(["original", "literal", "natural"])
            .parse(t.attributes["X-ZIVORA-KIND"] ?? "original"),
          has_speaker_names: t.attributes["X-ZIVORA-SPEAKERS"] === "YES",
          has_context_hints: t.attributes["X-ZIVORA-HINTS"] === "YES",
          language: t.language!,
          label: t.name,
          playlist_path: path,
          checksum_sha256: checksums[path],
          is_default: t.default,
          is_forced: t.attributes.FORCED === "YES",
        };
      }),
    thumbnails: [
      {
        sprite_prefix: "thumbnails/sprites/",
        sprite_checksums: Object.fromEntries(
          assets
            .filter((a) => a.path.startsWith("thumbnails/sprites/") && a.path.endsWith(".jpg"))
            .map((a) => [a.path, a.sha256]),
        ),
        vtt_path: descriptor.thumbnailVtt,
        vtt_checksum_sha256: checksums[descriptor.thumbnailVtt],
      },
    ],
  };
}

export class Publisher {
  constructor(
    private readonly versions: VersionManager,
    private readonly repository: PublicationRepository,
    private readonly uploader: (version: AllocatedVersion) => R2Uploader,
  ) {}

  async publish(input: unknown): Promise<AllocatedVersion> {
    const request = z
      .object({
        directory: z.string().min(1),
        contentId: z.string().uuid(),
        episodeId: z.string().uuid().nullable().default(null),
      })
      .strict()
      .parse(input);
    const { descriptor, assets } = await loadPublicationPackage(request.directory);
    const version = await this.versions.allocate({
      contentId: request.contentId,
      episodeId: request.episodeId,
    });
    return this.publishReserved({ directory: request.directory, version, descriptor, assets });
  }

  async publishReserved(
    input: unknown,
    hooks: PublicationProgressHooks = {},
  ): Promise<AllocatedVersion> {
    const request = z
      .object({
        directory: z.string().min(1),
        version: AllocatedVersionSchema,
        descriptor: ZivoraMediaDescriptorSchema.optional(),
        assets: z.array(UploadAssetSchema).optional(),
      })
      .strict()
      .parse(input);
    const loaded =
      request.descriptor && request.assets
        ? { descriptor: request.descriptor, assets: request.assets }
        : await loadPublicationPackage(request.directory);
    try {
      const uploader = this.uploader(request.version);
      await uploader.upload(request.directory, request.version.prefix, loaded.assets);
      await hooks.uploaded?.();
      const cloud = await validateCloudPackage(
        uploader,
        request.version,
        loaded.descriptor,
        loaded.assets,
      );
      await hooks.cloudValidated?.();
      await samplePlayback(uploader, request.version, cloud);
      await hooks.playbackTested?.();
      await this.repository.register(
        request.version.id,
        registration(loaded.descriptor, loaded.assets, cloud),
      );
      await hooks.registered?.();
      await this.repository.markReady(request.version.id);
      const id = z
        .string()
        .uuid()
        .parse(await this.repository.publish(request.version.id));
      if (id !== request.version.id)
        throw new Error("Published version does not match reservation");
      await hooks.published?.();
      return request.version;
    } catch (error) {
      // SQL only fails unpublished rows: a lost RPC response must not invalidate live media.
      try {
        await this.repository.fail(request.version.id);
      } catch {
        /* Preserve the original failure; reservation is never reused. */
      }
      throw error;
    }
  }

  async failReserved(versionId: string): Promise<void> {
    await this.repository.fail(z.string().uuid().parse(versionId));
  }

  async rollback(parentId: string): Promise<string> {
    return z
      .string()
      .uuid()
      .parse(await this.repository.rollback(z.string().uuid().parse(parentId)));
  }
}
