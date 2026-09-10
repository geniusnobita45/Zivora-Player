import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { AbrRenditionSchema, type EncodedRendition } from "./encode";
import type { ExtractedAudioTrack } from "./audio";
import type { ConvertedSubtitleTrack } from "./subtitles";
import { NodeProcessRunner, type CommandSpec, type ProcessRunner } from "./processRunner";

export const HLS_SEGMENT_SECONDS = 4;

const PathSchema = z.string().trim().min(1);
const PackagedSourceSchema = z
  .object({
    renditions: z
      .array(
        AbrRenditionSchema.extend({
          path: PathSchema,
          codec: z.literal("h264"),
          keyframeIntervalSeconds: z.literal(2),
        }),
      )
      .length(4),
    audioTracks: z
      .array(
        z.object({
          sourceStreamIndex: z.number().int().nonnegative(),
          language: z.string().min(1),
          label: z.string(),
          channels: z.number().int().positive().nullable(),
          path: PathSchema,
          codec: z.literal("aac"),
          bitrate: z.literal(192000),
        }),
      )
      .min(1),
    subtitleTracks: z.array(
      z.object({
        sourceStreamIndex: z.number().int().nonnegative().nullable(),
        language: z.string().min(1),
        label: z.string(),
        path: PathSchema,
        format: z.literal("webvtt"),
        cueCount: z.number().int().nonnegative(),
        kind: z.enum(["original", "literal", "natural"]).default("original"),
        hasSpeakerNames: z.boolean().default(false),
        hasContextHints: z.boolean().default(false),
      }),
    ),
  })
  .strict();

export interface PackagedPlaylist {
  kind: "video" | "audio" | "subtitle";
  id: string;
  language: string | null;
  path: string;
  segmentDirectory: string;
}

export interface PackageResult {
  masterPlaylist: string;
  playlists: PackagedPlaylist[];
  segmentDuration: 4;
}

function safeAttribute(input: string): string {
  return z
    .string()
    .max(256)
    .parse(input)
    .replace(/["\r\n]/g, "");
}

function uri(fromDirectory: string, path: string): string {
  return relative(fromDirectory, path).split(sep).join("/");
}

export function buildFmp4PackageCommand(
  sourcePath: string,
  playlistPath: string,
  segmentPattern: string,
  initFilename: string,
  kind: "video" | "audio",
  ffmpegBinary = "ffmpeg",
): CommandSpec {
  return {
    command: ffmpegBinary,
    cwd: dirname(playlistPath),
    args: [
      "-hide_banner",
      "-nostdin",
      "-y",
      "-i",
      sourcePath,
      "-map",
      kind === "video" ? "0:v:0" : "0:a:0",
      "-c",
      "copy",
      "-f",
      "hls",
      "-hls_time",
      String(HLS_SEGMENT_SECONDS),
      "-hls_segment_type",
      "fmp4",
      "-hls_fmp4_init_filename",
      initFilename,
      "-hls_playlist_type",
      "vod",
      "-hls_flags",
      "independent_segments",
      "-hls_segment_filename",
      relative(dirname(playlistPath), segmentPattern).split(sep).join("/"),
      basename(playlistPath),
    ],
  };
}

export function createSubtitlePlaylist(
  duration: number,
  subtitleFilename = "subtitles.vtt",
): string {
  const seconds = z.number().finite().positive().parse(duration);
  return [
    "#EXTM3U",
    "#EXT-X-VERSION:3",
    `#EXT-X-TARGETDURATION:${Math.max(1, Math.ceil(seconds))}`,
    "#EXT-X-MEDIA-SEQUENCE:0",
    "#EXT-X-PLAYLIST-TYPE:VOD",
    `#EXTINF:${seconds.toFixed(3)},`,
    subtitleFilename,
    "#EXT-X-ENDLIST",
    "",
  ].join("\n");
}

export function createMasterPlaylist(
  renditions: readonly EncodedRendition[],
  audio: readonly { id: string; language: string; label: string; playlistUri: string }[],
  subtitles: readonly {
    id: string;
    language: string;
    label: string;
    playlistUri: string;
    kind?: "original" | "literal" | "natural";
    hasSpeakerNames?: boolean;
    hasContextHints?: boolean;
  }[],
): string {
  if (!audio.length) throw new Error("At least one audio track is required");
  const lines = ["#EXTM3U", "#EXT-X-VERSION:7", "#EXT-X-INDEPENDENT-SEGMENTS"];
  audio.forEach((track, index) => {
    lines.push(
      `#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="${safeAttribute(track.label)}",LANGUAGE="${safeAttribute(track.language)}",AUTOSELECT=YES,DEFAULT=${index === 0 ? "YES" : "NO"},URI="${track.playlistUri}"`,
    );
  });
  subtitles.forEach((track, index) => {
    lines.push(
      `#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subtitles",NAME="${safeAttribute(track.label)}",LANGUAGE="${safeAttribute(track.language)}",AUTOSELECT=YES,DEFAULT=${index === 0 ? "YES" : "NO"},FORCED=NO,X-ZIVORA-KIND="${track.kind ?? "original"}",X-ZIVORA-SPEAKERS=${track.hasSpeakerNames ? "YES" : "NO"},X-ZIVORA-HINTS=${track.hasContextHints ? "YES" : "NO"},URI="${track.playlistUri}"`,
    );
  });
  for (const rendition of renditions) {
    const attributes = [
      `BANDWIDTH=${rendition.maxRate + 192000}`,
      `AVERAGE-BANDWIDTH=${rendition.videoBitrate + 192000}`,
      `RESOLUTION=${rendition.width}x${rendition.height}`,
      'CODECS="avc1.640028,mp4a.40.2"',
      'AUDIO="audio"',
      ...(subtitles.length ? ['SUBTITLES="subtitles"'] : []),
    ];
    lines.push(`#EXT-X-STREAM-INF:${attributes.join(",")}`, `video/${rendition.id}/index.m3u8`);
  }
  return `${lines.join("\n")}\n`;
}

export async function packageHlsCmaf(
  outputDirectory: string,
  sourceInput: {
    renditions: EncodedRendition[];
    audioTracks: ExtractedAudioTrack[];
    subtitleTracks: ConvertedSubtitleTrack[];
  },
  duration: number,
  runner: ProcessRunner = new NodeProcessRunner(),
  ffmpegBinary = "ffmpeg",
): Promise<PackageResult> {
  const source = PackagedSourceSchema.parse(sourceInput);
  const total = z.number().finite().positive().parse(duration);
  const playlists: PackagedPlaylist[] = [];
  for (const rendition of source.renditions) {
    const directory = join(outputDirectory, "video", rendition.id);
    const playlist = join(directory, "index.m3u8");
    await mkdir(join(directory, "segments"), { recursive: true });
    await runner.run(
      buildFmp4PackageCommand(
        rendition.path,
        playlist,
        join(directory, "segments", "segment-%06d.m4s"),
        "init.mp4",
        "video",
        ffmpegBinary,
      ),
    );
    playlists.push({
      kind: "video",
      id: rendition.id,
      language: null,
      path: playlist,
      segmentDirectory: join(directory, "segments"),
    });
  }
  const audioMaster: { id: string; language: string; label: string; playlistUri: string }[] = [];
  for (const [index, track] of source.audioTracks.entries()) {
    const id = `${String(index + 1).padStart(2, "0")}-${track.language}`;
    const directory = join(outputDirectory, "audio", id);
    const playlist = join(directory, "index.m3u8");
    await mkdir(join(directory, "segments"), { recursive: true });
    await runner.run(
      buildFmp4PackageCommand(
        track.path,
        playlist,
        join(directory, "segments", "segment-%06d.m4s"),
        "init.mp4",
        "audio",
        ffmpegBinary,
      ),
    );
    playlists.push({
      kind: "audio",
      id,
      language: track.language,
      path: playlist,
      segmentDirectory: join(directory, "segments"),
    });
    audioMaster.push({
      id,
      language: track.language,
      label: track.label,
      playlistUri: uri(outputDirectory, playlist),
    });
  }
  const subtitleMaster: Parameters<typeof createMasterPlaylist>[2][number][] = [];
  for (const [index, track] of source.subtitleTracks.entries()) {
    const id = `${String(index + 1).padStart(2, "0")}-${track.language}`;
    const directory = join(outputDirectory, "subtitles", id);
    const subtitle = join(directory, "subtitles.vtt");
    const playlist = join(directory, "index.m3u8");
    await mkdir(directory, { recursive: true });
    await copyFile(track.path, subtitle);
    await writeFile(playlist, createSubtitlePlaylist(total), "utf8");
    playlists.push({
      kind: "subtitle",
      id,
      language: track.language,
      path: playlist,
      segmentDirectory: directory,
    });
    subtitleMaster.push({
      kind: track.kind,
      hasSpeakerNames: track.hasSpeakerNames,
      hasContextHints: track.hasContextHints,
      id,
      language: track.language,
      label: `${track.label.replace(/\s*\[(original|literal|natural)\]$/, "")} [${track.kind}]`,
      playlistUri: uri(outputDirectory, playlist),
    });
  }
  const masterPlaylist = join(outputDirectory, "master.m3u8");
  await writeFile(
    masterPlaylist,
    createMasterPlaylist(source.renditions, audioMaster, subtitleMaster),
    "utf8",
  );
  return { masterPlaylist, playlists, segmentDuration: 4 };
}

async function main(): Promise<void> {
  const [requestPath] = process.argv.slice(2);
  if (!requestPath) throw new Error("Usage: tsx pipeline/media/package.ts <package-request.json>");
  const request = z
    .object({
      outputDirectory: PathSchema,
      duration: z.number().positive(),
      source: PackagedSourceSchema,
    })
    .strict()
    .parse(JSON.parse(await readFile(requestPath, "utf8")));
  process.stdout.write(
    `${JSON.stringify(await packageHlsCmaf(request.outputDirectory, request.source, request.duration), null, 2)}\n`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  void main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
