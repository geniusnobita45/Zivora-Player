import { cp, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ObjectStore, ObjectHeaders } from "@/lib/r2/ObjectStore";
import { versionPrefix } from "@/lib/r2/paths";
import { sha256 } from "@/pipeline/publish/R2Uploader";
import { parseManifest } from "@/pipeline/validation/ManifestValidator";
import {
  ValidationCheckNameSchema,
  type ZivoraMediaDescriptor,
} from "@/pipeline/validation/MediaValidator";
import { ABR_LADDER } from "@/pipeline/media/encode";

export const contentId = "11111111-1111-4111-8111-111111111111";
export const episodeId = "22222222-2222-4222-8222-222222222222";
export const versionId = "33333333-3333-4333-8333-333333333333";
export const userId = "44444444-4444-4444-8444-444444444444";
export const prefix = versionPrefix(contentId, episodeId, 1);
export const version = {
  id: versionId,
  contentId,
  episodeId,
  prefix,
  versionNumber: 1,
  access: "private" as const,
};

export function box(type: string, ...payload: Uint8Array[]): Buffer {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(8 + payload.reduce((n, b) => n + b.length, 0));
  header.write(type, 4, 4, "ascii");
  return Buffer.concat([header, ...payload]);
}
export const initBytes = () =>
  Buffer.concat([box("ftyp", Buffer.from("iso60000")), box("moov", box("trak"), box("mvex"))]);
export const segmentBytes = () =>
  Buffer.concat([
    box("moof", box("mfhd"), box("traf", box("tfhd"), box("tfdt"), box("trun"))),
    box("mdat", Buffer.from([1, 2, 3])),
  ]);

export class MemoryStore implements ObjectStore {
  readonly objects = new Map<string, { bytes: Uint8Array; headers: ObjectHeaders }>();
  readonly operations: string[] = [];
  async prefixExists(prefix: string) {
    this.operations.push("list");
    return [...this.objects.keys()].some((key) => key.startsWith(prefix));
  }
  async putIfAbsent(key: string, bytes: Uint8Array, headers: ObjectHeaders) {
    this.operations.push(`put:${key}`);
    if (this.objects.has(key)) throw new Error("PreconditionFailed");
    this.objects.set(key, { bytes: bytes.slice(), headers: { ...headers } });
  }
  async get(key: string, maxBytes = Infinity) {
    this.operations.push(`get:${key}`);
    const value = this.objects.get(key);
    if (!value || value.bytes.length > maxBytes) throw new Error("Missing/oversized object");
    return value.bytes.slice();
  }
  async head(key: string) {
    this.operations.push(`head:${key}`);
    const value = this.objects.get(key);
    if (!value) throw new Error("Missing object");
    return { ...value.headers };
  }
}

export async function publicationFixture() {
  const root = await mkdtemp(join(tmpdir(), "zivora-publish-test-"));
  await cp(fileURLToPath(new URL("../pipeline/fixtures/valid/", import.meta.url)), root, {
    recursive: true,
  });
  const paths: string[] = [];
  async function visit(directory = "") {
    for (const entry of await readdir(join(root, directory), { withFileTypes: true })) {
      const path = directory ? `${directory}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await visit(path);
      else paths.push(path);
    }
  }
  await visit();
  for (const path of paths) {
    if (path.endsWith("init.mp4")) await writeFile(join(root, path), initBytes());
    if (path.endsWith(".m4s")) await writeFile(join(root, path), segmentBytes());
  }
  const master = parseManifest(await readFile(join(root, "master.m3u8"), "utf8"));
  if (master.kind !== "master") throw new Error("Invalid fixture");
  const tracks = (type: "AUDIO" | "SUBTITLES") =>
    master.media
      .filter((t) => t.type === type)
      .map((t) => ({ language: t.language!, name: t.name, playlist: t.uri }));
  const descriptor: ZivoraMediaDescriptor = {
    schemaVersion: 1,
    generatedAt: "2026-01-01T00:00:00.000Z",
    durationSeconds: 8,
    masterPlaylist: "master.m3u8",
    renditions: ABR_LADDER.map((r, i) => ({
      id: r.id,
      width: r.width,
      height: r.height,
      bandwidth: master.variants[i].bandwidth,
      playlist: master.variants[i].uri,
    })),
    audioTracks: tracks("AUDIO"),
    subtitleTracks: tracks("SUBTITLES"),
    thumbnailVtt: "thumbnails/thumbnails.vtt",
    assets: await Promise.all(
      paths
        .filter((p) => p !== "probe-target.mp4")
        .map(async (path) => {
          const bytes = await readFile(join(root, path));
          return { path, size: bytes.length, sha256: sha256(bytes) };
        }),
    ),
    validation: {
      checkedAt: "2026-01-01T00:00:00.000Z",
      checks: ValidationCheckNameSchema.options.map((name) => ({ name, status: "passed" })),
    },
  };
  await writeFile(join(root, "zivora-media.json"), JSON.stringify(descriptor));
  return { root, descriptor };
}
