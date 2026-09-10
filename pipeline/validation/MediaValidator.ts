import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { link, lstat, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { normalizeLanguageTag } from "@/pipeline/media/audio";
import { parseWebVtt } from "@/pipeline/media/subtitles";
import {
  SubtitleAttributesSchema,
  parseWebVtt as parseCaptionWebVtt,
} from "@/features/subtitles/vtt";
import { probeMedia, ProbeResultSchema, type ProbeResult } from "@/pipeline/media/probe";
import {
  ManifestValidator,
  resolveManifestPath,
  type ManifestTree,
  type MediaPlaylist,
} from "./ManifestValidator";

export const ValidationCheckNameSchema = z.enum([
  "ffprobe",
  "codec",
  "duration",
  "segment-existence",
  "segment-duration-sum",
  "audio-track",
  "subtitle",
  "thumbnail",
]);
export type ValidationCheckName = z.infer<typeof ValidationCheckNameSchema>;
export interface ValidationCheck {
  name: ValidationCheckName;
  status: "passed" | "failed";
  message: string;
  details: Record<string, unknown>;
}
export interface MediaValidationReport {
  valid: boolean;
  mediaRoot: string;
  masterPlaylist: string;
  checkedAt: string;
  checks: ValidationCheck[];
}

export const MediaValidationInputSchema = z
  .object({
    mediaRoot: z.string().trim().min(1),
    masterPlaylist: z.string().trim().min(1),
    probeTarget: z.string().trim().min(1),
    thumbnailVtt: z.string().trim().min(1),
    expectedDuration: z.number().finite().positive().optional(),
  })
  .strict();
export type MediaValidationInput = z.infer<typeof MediaValidationInputSchema>;

export interface MediaValidatorDependencies {
  probe?: (path: string) => Promise<ProbeResult>;
  manifestValidator?: ManifestValidator;
  now?: () => Date;
  stat?: typeof stat;
  readText?: (path: string) => Promise<string>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function check(
  name: ValidationCheckName,
  operation: () => Record<string, unknown> | Promise<Record<string, unknown>>,
): Promise<ValidationCheck> {
  return Promise.resolve()
    .then(operation)
    .then((details) => ({
      name,
      status: "passed" as const,
      message: `${name} validation passed`,
      details,
    }))
    .catch((error: unknown) => ({
      name,
      status: "failed" as const,
      message: errorMessage(error),
      details: {},
    }));
}

function requireProbe(value: ProbeResult | null): ProbeResult {
  if (!value) throw new Error("FFprobe result is unavailable because the preceding check failed");
  return value;
}

function requireTree(value: ManifestTree | null): ManifestTree {
  if (!value) throw new Error("Manifest tree is unavailable because segment validation failed");
  return value;
}

function playlistDuration(playlist: MediaPlaylist): number {
  return playlist.segments.reduce((total, segment) => total + segment.duration, 0);
}

async function assertFile(path: string, inspect: typeof stat): Promise<number> {
  const value = await inspect(path);
  if (!value.isFile() || value.size <= 0)
    throw new Error(`Required media file is missing or empty: ${path}`);
  return value.size;
}

function expectedLanguages(probe: ProbeResult, type: "audio" | "subtitle"): string[] {
  return probe.streams
    .filter((stream) => stream.codec_type === type)
    .map((stream, index) =>
      normalizeLanguageTag(stream.tags.language, `und-x-${type}-${index + 1}`),
    );
}

export class MediaValidator {
  private readonly inspect: typeof stat;
  private readonly readText: (path: string) => Promise<string>;
  private readonly manifest: ManifestValidator;
  private readonly probe: (path: string) => Promise<ProbeResult>;
  private readonly now: () => Date;

  constructor(dependencies: MediaValidatorDependencies = {}) {
    this.inspect = dependencies.stat ?? stat;
    this.readText = dependencies.readText ?? ((path) => readFile(path, "utf8"));
    this.manifest = dependencies.manifestValidator ?? new ManifestValidator(this.readText);
    this.probe = dependencies.probe ?? probeMedia;
    this.now = dependencies.now ?? (() => new Date());
  }

  async validate(input: MediaValidationInput): Promise<MediaValidationReport> {
    const value = MediaValidationInputSchema.parse(input);
    const mediaRoot = resolve(value.mediaRoot);
    const masterPlaylist = resolveInside(mediaRoot, value.masterPlaylist);
    const probeTarget = resolveInside(mediaRoot, value.probeTarget);
    const thumbnailVtt = resolveInside(mediaRoot, value.thumbnailVtt);
    const checks: ValidationCheck[] = [];
    let probe: ProbeResult | null = null;
    let tree: ManifestTree | null = null;

    checks.push(
      await check("ffprobe", async () => {
        probe = ProbeResultSchema.parse(await this.probe(probeTarget));
        return { streams: probe.streams.length, format: probe.format.format_name };
      }),
    );
    checks.push(
      await check("codec", () => {
        const result = requireProbe(probe);
        const video = result.streams.filter((stream) => stream.codec_type === "video");
        const audio = result.streams.filter((stream) => stream.codec_type === "audio");
        if (
          !video.length ||
          video.some((stream) => !["h264", "avc1"].includes(stream.codec_name.toLowerCase()))
        )
          throw new Error("All packaged video streams must use H.264");
        if (
          !audio.length ||
          audio.some((stream) => !["aac", "mp4a"].includes(stream.codec_name.toLowerCase()))
        )
          throw new Error("All packaged audio streams must use AAC");
        return {
          videoCodecs: video.map((stream) => stream.codec_name),
          audioCodecs: audio.map((stream) => stream.codec_name),
        };
      }),
    );
    checks.push(
      await check("duration", () => {
        const result = requireProbe(probe);
        const actual = result.format.duration;
        const expected = value.expectedDuration ?? actual;
        const differenceRatio = Math.abs(actual - expected) / expected;
        if (differenceRatio > 0.01)
          throw new Error(
            `Probed duration differs from expected duration by ${(differenceRatio * 100).toFixed(3)}%`,
          );
        return { actualSeconds: actual, expectedSeconds: expected, differenceRatio };
      }),
    );
    checks.push(
      await check("segment-existence", async () => {
        tree = await this.manifest.parseTree(masterPlaylist);
        let fileCount = 1;
        let totalBytes = await assertFile(masterPlaylist, this.inspect);
        for (const child of tree.children) {
          totalBytes += await assertFile(child.path, this.inspect);
          fileCount++;
          if (child.kind !== "subtitle") {
            if (!child.playlist.initSegmentUri?.toLowerCase().endsWith(".mp4"))
              throw new Error(`CMAF init segment must be MP4: ${child.path}`);
            if (
              child.playlist.segments.some((segment) => !segment.uri.toLowerCase().endsWith(".m4s"))
            )
              throw new Error(`CMAF media segments must use .m4s: ${child.path}`);
          }
          const references = [
            ...(child.playlist.initSegmentUri ? [child.playlist.initSegmentUri] : []),
            ...child.playlist.segments.map((segment) => segment.uri),
          ];
          for (const reference of references) {
            const path = resolveManifestPath(mediaRoot, child.path, reference);
            totalBytes += await assertFile(path, this.inspect);
            fileCount++;
          }
        }
        return { fileCount, totalBytes, childPlaylists: tree.children.length };
      }),
    );
    checks.push(
      await check("segment-duration-sum", () => {
        const manifest = requireTree(tree);
        const duration = requireProbe(probe).format.duration;
        const sums = manifest.children.map((child) => ({
          kind: child.kind,
          path: relative(mediaRoot, child.path),
          seconds: playlistDuration(child.playlist),
        }));
        for (const item of sums) {
          const ratio = Math.abs(item.seconds - duration) / duration;
          if (ratio > 0.01)
            throw new Error(
              `${item.path} segment duration sum differs from probe duration by ${(ratio * 100).toFixed(3)}%`,
            );
        }
        return { durationSeconds: duration, playlists: sums };
      }),
    );
    checks.push(
      await check("audio-track", () => {
        const result = requireProbe(probe);
        const manifest = requireTree(tree);
        const sourceLanguages = expectedLanguages(result, "audio");
        const tracks = manifest.master.media.filter((entry) => entry.type === "AUDIO");
        if (!tracks.length) throw new Error("Master playlist has no audio tracks");
        const manifestLanguages = tracks.map((entry) => entry.language ?? "und");
        for (const language of sourceLanguages) {
          if (!manifestLanguages.includes(language))
            throw new Error(`Audio language is missing from the master playlist: ${language}`);
        }
        const defaults = tracks.filter((entry) => entry.default);
        if (defaults.length !== 1)
          throw new Error("Master playlist must have exactly one default audio track");
        return {
          sourceLanguages,
          manifestLanguages,
          defaultLanguage: defaults[0].language ?? "und",
        };
      }),
    );
    checks.push(
      await check("subtitle", async () => {
        const result = requireProbe(probe);
        const manifest = requireTree(tree);
        const duration = result.format.duration;
        const children = manifest.children.filter((child) => child.kind === "subtitle");
        const declared = manifest.master.media.filter((entry) => entry.type === "SUBTITLES");
        declared.forEach((entry) => SubtitleAttributesSchema.parse(entry.attributes));
        if (children.length !== declared.length)
          throw new Error("Subtitle declarations and playlists do not match");
        const sourceLanguages = expectedLanguages(result, "subtitle");
        const manifestLanguages = declared.map((entry) => entry.language ?? "und");
        for (const language of sourceLanguages) {
          if (!manifestLanguages.includes(language))
            throw new Error(`Subtitle language is missing from the master playlist: ${language}`);
        }
        let cueCount = 0;
        for (const child of children) {
          for (const segment of child.playlist.segments) {
            if (!segment.uri.toLowerCase().endsWith(".vtt"))
              throw new Error(`Subtitle segment is not WebVTT: ${segment.uri}`);
            const path = resolveManifestPath(mediaRoot, child.path, segment.uri);
            const cues = parseCaptionWebVtt(await this.readText(path));
            if (!cues.length) throw new Error(`Subtitle WebVTT has no cues: ${segment.uri}`);
            if (cues.some((cue) => cue.start < 0 || cue.end > duration * 1.01))
              throw new Error(`Subtitle cue exceeds media duration: ${segment.uri}`);
            cueCount += cues.length;
          }
        }
        return { tracks: children.length, cues: cueCount, sourceLanguages, manifestLanguages };
      }),
    );
    checks.push(
      await check("thumbnail", async () => {
        const result = requireProbe(probe);
        await assertFile(thumbnailVtt, this.inspect);
        const cues = parseWebVtt(await this.readText(thumbnailVtt));
        if (!cues.length) throw new Error("Thumbnail WebVTT has no cues");
        const duration = result.format.duration;
        if (cues[0].start > 0.001 || Math.abs(cues.at(-1)!.end - duration) / duration > 0.01)
          throw new Error("Thumbnail cues do not span the media duration");
        const sprites = new Set<string>();
        for (const cue of cues) {
          const match = cue.text.match(/^([^#\s]+\.jpg)#xywh=(\d+),(\d+),(\d+),(\d+)$/i);
          if (!match) throw new Error(`Invalid thumbnail cue payload: ${cue.text}`);
          const [, referenced, x, y, width, height] = match;
          if (
            Number(width) !== 320 ||
            Number(height) !== 180 ||
            Number(x) % 320 !== 0 ||
            Number(y) % 180 !== 0 ||
            Number(x) >= 3200 ||
            Number(y) >= 1800
          )
            throw new Error(`Invalid thumbnail sprite coordinates: ${cue.text}`);
          const path = resolveManifestPath(mediaRoot, thumbnailVtt, referenced);
          await assertFile(path, this.inspect);
          sprites.add(path);
        }
        return { cues: cues.length, sprites: sprites.size, intervalSeconds: 5 };
      }),
    );

    return {
      valid: checks.every((item) => item.status === "passed"),
      mediaRoot,
      masterPlaylist: relative(mediaRoot, masterPlaylist).split(sep).join("/"),
      checkedAt: z.date().parse(this.now()).toISOString(),
      checks,
    };
  }
}

function resolveInside(rootInput: string, pathInput: string): string {
  const root = resolve(rootInput);
  const target = resolve(root, pathInput);
  if (target !== root && !target.startsWith(`${root}${sep}`))
    throw new Error(`Path escapes media root: ${pathInput}`);
  return target;
}

export const MediaAssetSchema = z.object({
  path: z.string().min(1),
  size: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});
export const ZivoraMediaDescriptorSchema = z.object({
  schemaVersion: z.literal(1),
  generatedAt: z.string().datetime(),
  durationSeconds: z.number().positive(),
  masterPlaylist: z.string().min(1),
  renditions: z.array(
    z.object({
      id: z.string(),
      width: z.number().int().positive(),
      height: z.number().int().positive(),
      bandwidth: z.number().int().positive(),
      playlist: z.string(),
    }),
  ),
  audioTracks: z.array(z.object({ language: z.string(), name: z.string(), playlist: z.string() })),
  subtitleTracks: z.array(
    z.object({
      language: z.string(),
      name: z.string(),
      playlist: z.string(),
      kind: z.enum(["original", "literal", "natural"]).optional(),
      hasSpeakerNames: z.boolean().optional(),
      hasContextHints: z.boolean().optional(),
    }),
  ),
  thumbnailVtt: z.string().min(1),
  assets: z.array(MediaAssetSchema),
  validation: z.object({
    checkedAt: z.string().datetime(),
    checks: z.array(
      z.object({ name: ValidationCheckNameSchema, status: z.enum(["passed", "failed"]) }),
    ),
  }),
});
export type ZivoraMediaDescriptor = z.infer<typeof ZivoraMediaDescriptorSchema>;

async function listFiles(root: string, directory = root): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isSymbolicLink())
      throw new Error(`Media output cannot contain symbolic links: ${path}`);
    if (entry.isDirectory()) files.push(...(await listFiles(root, path)));
    else if (entry.isFile() && entry.name !== "zivora-media.json") files.push(path);
  }
  return files.sort();
}

async function checksum(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

export async function writeMediaDescriptor(
  input: MediaValidationInput,
  report: MediaValidationReport,
  dependencies: {
    manifestValidator?: ManifestValidator;
    probe?: (path: string) => Promise<ProbeResult>;
  } = {},
): Promise<ZivoraMediaDescriptor> {
  if (!report.valid) throw new Error("Cannot describe media that failed validation");
  const value = MediaValidationInputSchema.parse(input);
  const root = resolve(value.mediaRoot);
  const tree = await (dependencies.manifestValidator ?? new ManifestValidator()).parseTree(
    resolveInside(root, value.masterPlaylist),
  );
  const probe = await (dependencies.probe ?? probeMedia)(resolveInside(root, value.probeTarget));
  const paths = await listFiles(root);
  const assets = await Promise.all(
    paths.map(async (path) => ({
      path: relative(root, path).split(sep).join("/"),
      size: (await lstat(path)).size,
      sha256: await checksum(path),
    })),
  );
  const descriptor = ZivoraMediaDescriptorSchema.parse({
    schemaVersion: 1,
    generatedAt: report.checkedAt,
    durationSeconds: probe.format.duration,
    masterPlaylist: relative(root, tree.masterPath).split(sep).join("/"),
    renditions: tree.master.variants.map((variant) => ({
      id: `${variant.resolution.height}p`,
      width: variant.resolution.width,
      height: variant.resolution.height,
      bandwidth: variant.bandwidth,
      playlist: variant.uri,
    })),
    audioTracks: tree.master.media
      .filter((track) => track.type === "AUDIO")
      .map((track) => ({
        language: track.language ?? "und",
        name: track.name,
        playlist: track.uri,
      })),
    subtitleTracks: tree.master.media
      .filter((track) => track.type === "SUBTITLES")
      .map((track) => ({
        kind: z
          .enum(["original", "literal", "natural"])
          .parse(track.attributes["X-ZIVORA-KIND"] ?? "original"),
        hasSpeakerNames: track.attributes["X-ZIVORA-SPEAKERS"] === "YES",
        hasContextHints: track.attributes["X-ZIVORA-HINTS"] === "YES",
        language: track.language ?? "und",
        name: track.name,
        playlist: track.uri,
      })),
    thumbnailVtt: relative(root, resolveInside(root, value.thumbnailVtt)).split(sep).join("/"),
    assets,
    validation: {
      checkedAt: report.checkedAt,
      checks: report.checks.map(({ name, status }) => ({ name, status })),
    },
  });
  const destination = resolve(root, "zivora-media.json");
  const temporary = resolve(root, `.zivora-media.${process.pid}.${Date.now()}.tmp`);
  await writeFile(temporary, `${JSON.stringify(descriptor, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  try {
    // A hard link gives atomic create-if-absent semantics; existing immutable descriptors are never replaced.
    await link(temporary, destination);
  } finally {
    await rm(temporary, { force: true });
  }
  return descriptor;
}

async function main(): Promise<void> {
  const [requestPath, writeFlag] = process.argv.slice(2);
  if (!requestPath)
    throw new Error(
      "Usage: tsx pipeline/validation/MediaValidator.ts <validation-request.json> [--write-descriptor]",
    );
  const input = MediaValidationInputSchema.parse(JSON.parse(await readFile(requestPath, "utf8")));
  const validator = new MediaValidator();
  const report = await validator.validate(input);
  if (writeFlag === "--write-descriptor" && report.valid) await writeMediaDescriptor(input, report);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.valid) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  void main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
