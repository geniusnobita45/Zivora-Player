import { readFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

export const ManifestAttributeSchema = z.record(z.string());
export type ManifestAttributes = z.infer<typeof ManifestAttributeSchema>;

export const MasterVariantSchema = z.object({
  uri: z.string().min(1),
  bandwidth: z.number().int().positive(),
  averageBandwidth: z.number().int().positive().optional(),
  resolution: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }),
  codecs: z.array(z.string().min(1)).min(1),
  audioGroup: z.string().min(1).optional(),
  subtitleGroup: z.string().min(1).optional(),
  attributes: ManifestAttributeSchema,
});

export const MasterMediaSchema = z.object({
  type: z.enum(["AUDIO", "SUBTITLES"]),
  groupId: z.string().min(1),
  name: z.string().min(1),
  language: z.string().min(1).optional(),
  uri: z.string().min(1),
  default: z.boolean(),
  autoSelect: z.boolean(),
  attributes: ManifestAttributeSchema,
});

export interface MasterPlaylist {
  kind: "master";
  version: number | null;
  variants: z.infer<typeof MasterVariantSchema>[];
  media: z.infer<typeof MasterMediaSchema>[];
  independentSegments: boolean;
}

export interface MediaSegment {
  uri: string;
  duration: number;
  title: string;
  byteRange: string | null;
}

export interface MediaPlaylist {
  kind: "media";
  version: number | null;
  targetDuration: number;
  mediaSequence: number;
  playlistType: "VOD" | "EVENT" | null;
  endList: boolean;
  independentSegments: boolean;
  initSegmentUri: string | null;
  segments: MediaSegment[];
}

export type ParsedPlaylist = MasterPlaylist | MediaPlaylist;

function unquote(value: string): string {
  const trimmed = value.trim();
  return trimmed.startsWith('"') && trimmed.endsWith('"') ? trimmed.slice(1, -1) : trimmed;
}

export function parseAttributeList(input: string): ManifestAttributes {
  const attributes: Record<string, string> = {};
  let token = "";
  let quoted = false;
  const commit = () => {
    const separator = token.indexOf("=");
    if (separator <= 0) throw new Error(`Invalid HLS attribute: ${token}`);
    const key = token.slice(0, separator).trim();
    if (!/^[A-Z0-9-]+$/.test(key) || key in attributes)
      throw new Error(`Invalid or duplicate HLS attribute: ${key}`);
    attributes[key] = unquote(token.slice(separator + 1));
    token = "";
  };
  for (const character of input) {
    if (character === '"') quoted = !quoted;
    if (character === "," && !quoted) commit();
    else token += character;
  }
  if (quoted) throw new Error("Unterminated quoted HLS attribute");
  if (token.trim()) commit();
  return ManifestAttributeSchema.parse(attributes);
}

function yesNo(value: string | undefined): boolean {
  if (value === undefined || value === "NO") return false;
  if (value === "YES") return true;
  throw new Error(`Expected YES or NO, received ${value}`);
}

function positiveInteger(value: string | undefined, name: string): number {
  return z.coerce
    .number()
    .int()
    .positive()
    .parse(value, { path: [name] });
}

function parseVersion(lines: readonly string[]): number | null {
  const line = lines.find((value) => value.startsWith("#EXT-X-VERSION:"));
  return line ? positiveInteger(line.slice("#EXT-X-VERSION:".length), "version") : null;
}

export function parseManifest(input: unknown): ParsedPlaylist {
  const text = z
    .string()
    .min(1)
    .parse(input)
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n");
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines[0] !== "#EXTM3U") throw new Error("HLS playlist must begin with #EXTM3U");
  const version = parseVersion(lines);
  const independentSegments = lines.includes("#EXT-X-INDEPENDENT-SEGMENTS");
  const master = lines.some((line) => line.startsWith("#EXT-X-STREAM-INF:"));
  if (master) {
    const variants: MasterPlaylist["variants"] = [];
    const media: MasterPlaylist["media"] = [];
    for (let index = 1; index < lines.length; index++) {
      const line = lines[index];
      if (line.startsWith("#EXT-X-MEDIA:")) {
        const attributes = parseAttributeList(line.slice("#EXT-X-MEDIA:".length));
        media.push(
          MasterMediaSchema.parse({
            type: attributes.TYPE,
            groupId: attributes["GROUP-ID"],
            name: attributes.NAME,
            language: attributes.LANGUAGE,
            uri: attributes.URI,
            default: yesNo(attributes.DEFAULT),
            autoSelect: yesNo(attributes.AUTOSELECT),
            attributes,
          }),
        );
      }
      if (line.startsWith("#EXT-X-STREAM-INF:")) {
        const attributes = parseAttributeList(line.slice("#EXT-X-STREAM-INF:".length));
        const uri = lines[++index];
        if (!uri || uri.startsWith("#"))
          throw new Error("Variant declaration must be followed by a URI");
        const resolution = attributes.RESOLUTION?.match(/^(\d+)x(\d+)$/);
        if (!resolution) throw new Error("Variant is missing a valid RESOLUTION");
        variants.push(
          MasterVariantSchema.parse({
            uri,
            bandwidth: positiveInteger(attributes.BANDWIDTH, "bandwidth"),
            averageBandwidth: attributes["AVERAGE-BANDWIDTH"]
              ? positiveInteger(attributes["AVERAGE-BANDWIDTH"], "averageBandwidth")
              : undefined,
            resolution: { width: Number(resolution[1]), height: Number(resolution[2]) },
            codecs: attributes.CODECS?.split(",")
              .map((codec) => codec.trim())
              .filter(Boolean),
            audioGroup: attributes.AUDIO,
            subtitleGroup: attributes.SUBTITLES,
            attributes,
          }),
        );
      }
    }
    if (!variants.length) throw new Error("Master playlist has no variants");
    for (const variant of variants) {
      if (
        variant.audioGroup &&
        !media.some((track) => track.type === "AUDIO" && track.groupId === variant.audioGroup)
      )
        throw new Error(`Variant references missing audio group ${variant.audioGroup}`);
      if (
        variant.subtitleGroup &&
        !media.some(
          (track) => track.type === "SUBTITLES" && track.groupId === variant.subtitleGroup,
        )
      )
        throw new Error(`Variant references missing subtitle group ${variant.subtitleGroup}`);
    }
    return { kind: "master", version, variants, media, independentSegments };
  }
  const target = lines.find((line) => line.startsWith("#EXT-X-TARGETDURATION:"));
  if (!target) throw new Error("Media playlist is missing EXT-X-TARGETDURATION");
  const segments: MediaSegment[] = [];
  let pendingDuration: { duration: number; title: string } | null = null;
  let byteRange: string | null = null;
  let initSegmentUri: string | null = null;
  for (const line of lines.slice(1)) {
    if (line.startsWith("#EXTINF:")) {
      if (pendingDuration) throw new Error("EXTINF is missing a segment URI");
      const [duration, ...title] = line.slice("#EXTINF:".length).split(",");
      pendingDuration = {
        duration: z.coerce.number().finite().positive().parse(duration),
        title: title.join(","),
      };
    } else if (line.startsWith("#EXT-X-BYTERANGE:")) {
      byteRange = line.slice("#EXT-X-BYTERANGE:".length);
    } else if (line.startsWith("#EXT-X-MAP:")) {
      const attributes = parseAttributeList(line.slice("#EXT-X-MAP:".length));
      initSegmentUri = z.string().min(1).parse(attributes.URI);
    } else if (!line.startsWith("#") && pendingDuration) {
      segments.push({
        uri: line,
        duration: pendingDuration.duration,
        title: pendingDuration.title,
        byteRange,
      });
      pendingDuration = null;
      byteRange = null;
    }
  }
  if (pendingDuration) throw new Error("EXTINF is missing a final segment URI");
  if (!segments.length) throw new Error("Media playlist has no segments");
  const targetDuration = positiveInteger(
    target.slice("#EXT-X-TARGETDURATION:".length),
    "targetDuration",
  );
  if (segments.some((segment) => Math.round(segment.duration) > targetDuration)) {
    throw new Error("Media segment duration exceeds EXT-X-TARGETDURATION");
  }
  const sequenceLine = lines.find((line) => line.startsWith("#EXT-X-MEDIA-SEQUENCE:"));
  const typeLine = lines.find((line) => line.startsWith("#EXT-X-PLAYLIST-TYPE:"));
  const playlistType = typeLine
    ? z.enum(["VOD", "EVENT"]).parse(typeLine.slice("#EXT-X-PLAYLIST-TYPE:".length))
    : null;
  return {
    kind: "media",
    version,
    targetDuration,
    mediaSequence: sequenceLine
      ? z.coerce
          .number()
          .int()
          .nonnegative()
          .parse(sequenceLine.slice("#EXT-X-MEDIA-SEQUENCE:".length))
      : 0,
    playlistType,
    endList: lines.includes("#EXT-X-ENDLIST"),
    independentSegments,
    initSegmentUri,
    segments,
  };
}

export function resolveManifestPath(
  rootDirectory: string,
  playlistPath: string,
  referencedUri: string,
): string {
  const reference = z.string().trim().min(1).parse(referencedUri);
  if (
    /^[a-z][a-z0-9+.-]*:/i.test(reference) ||
    reference.startsWith("//") ||
    reference.includes("?") ||
    reference.includes("#")
  ) {
    throw new Error(`Manifest contains a non-local URI: ${reference}`);
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(reference);
  } catch {
    throw new Error(`Manifest contains an invalid URI: ${reference}`);
  }
  const root = resolve(rootDirectory);
  const target = resolve(dirname(playlistPath), decoded);
  if (target !== root && !target.startsWith(`${root}${sep}`))
    throw new Error(`Manifest URI escapes media root: ${reference}`);
  return target;
}

export interface ManifestTree {
  masterPath: string;
  master: MasterPlaylist;
  children: {
    path: string;
    kind: "video" | "audio" | "subtitle";
    language: string | null;
    playlist: MediaPlaylist;
  }[];
}

export class ManifestValidator {
  constructor(
    private readonly readText: (path: string) => Promise<string> = (path) => readFile(path, "utf8"),
  ) {}

  async parseTree(masterPath: string): Promise<ManifestTree> {
    const absoluteMaster = resolve(z.string().trim().min(1).parse(masterPath));
    const root = dirname(absoluteMaster);
    const parsed = parseManifest(await this.readText(absoluteMaster));
    if (parsed.kind !== "master") throw new Error("Expected an HLS master playlist");
    const references = [
      ...parsed.variants.map((variant) => ({
        uri: variant.uri,
        kind: "video" as const,
        language: null,
      })),
      ...parsed.media.map((track) => ({
        uri: track.uri,
        kind: track.type === "AUDIO" ? ("audio" as const) : ("subtitle" as const),
        language: track.language ?? null,
      })),
    ];
    const unique = new Map<string, (typeof references)[number]>();
    references.forEach((reference) => unique.set(reference.uri, reference));
    const children: ManifestTree["children"] = [];
    for (const reference of unique.values()) {
      const path = resolveManifestPath(root, absoluteMaster, reference.uri);
      const child = parseManifest(await this.readText(path));
      if (child.kind !== "media")
        throw new Error(`Nested master playlist is unsupported: ${reference.uri}`);
      if (child.playlistType !== "VOD" || !child.endList)
        throw new Error(`Published child playlist must be finite VOD: ${reference.uri}`);
      if (reference.kind !== "subtitle" && !child.initSegmentUri)
        throw new Error(`CMAF playlist is missing EXT-X-MAP: ${reference.uri}`);
      children.push({ path, kind: reference.kind, language: reference.language, playlist: child });
    }
    return { masterPath: absoluteMaster, master: parsed, children };
  }
}

async function main(): Promise<void> {
  const masterPath = process.argv[2];
  if (!masterPath)
    throw new Error("Usage: tsx pipeline/validation/ManifestValidator.ts <master.m3u8>");
  process.stdout.write(
    `${JSON.stringify(await new ManifestValidator().parseTree(masterPath), null, 2)}\n`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  void main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
