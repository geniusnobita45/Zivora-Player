import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { resolve, sep, extname } from "node:path";
import { z } from "zod";
import { objectKey, ObjectPathSchema, Sha256Schema, VersionPrefixSchema } from "@/lib/r2/paths";
import { parallelMap, type ObjectStore, type ObjectHeaders } from "@/lib/r2/ObjectStore";
import { MAX_OBJECT_BYTES } from "@/lib/r2/client";

export const UploadAssetSchema = z
  .object({
    path: ObjectPathSchema,
    size: z.number().int().positive().max(MAX_OBJECT_BYTES),
    sha256: Sha256Schema,
  })
  .strict();
export type UploadAsset = z.infer<typeof UploadAssetSchema>;
export const sha256 = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

export function uploadHeaders(asset: UploadAsset): ObjectHeaders {
  const types: Record<string, string> = {
    ".m3u8": "application/vnd.apple.mpegurl",
    ".m4s": "video/iso.segment",
    ".mp4": "video/mp4",
    ".vtt": "text/vtt; charset=utf-8",
    ".jpg": "image/jpeg",
    ".json": "application/json",
  };
  const extension = extname(asset.path).toLowerCase();
  let contentType = types[extension];
  if (!contentType) throw new Error(`Unsupported publication asset: ${asset.path}`);
  if (asset.path.startsWith("audio/") && [".m4s", ".mp4"].includes(extension))
    contentType = "audio/mp4";
  return {
    size: asset.size,
    sha256: asset.sha256,
    contentType,
    cacheControl:
      extension === ".m3u8"
        ? "public, max-age=60, must-revalidate"
        : "public, max-age=31536000, immutable",
  };
}

export async function readPublicationFile(
  rootInput: string,
  asset: UploadAsset,
): Promise<Uint8Array> {
  const root = await realpath(rootInput);
  const path = resolve(root, ObjectPathSchema.parse(asset.path));
  if (
    !path.startsWith(`${root}${sep}`) ||
    (await realpath(path)) !== path ||
    !(await lstat(path)).isFile()
  ) {
    throw new Error("Publication file escapes its root or is a symbolic link");
  }
  if ((await lstat(path)).size !== asset.size) throw new Error(`Asset size changed: ${asset.path}`);
  const bytes = await readFile(path);
  if (bytes.byteLength !== asset.size || sha256(bytes) !== asset.sha256)
    throw new Error(`Asset checksum mismatch: ${asset.path}`);
  return bytes;
}

export class R2Uploader {
  constructor(
    readonly store: ObjectStore,
    private readonly concurrency = 4,
  ) {}

  async upload(root: string, prefixInput: string, input: unknown): Promise<UploadAsset[]> {
    const prefix = VersionPrefixSchema.parse(prefixInput);
    const assets = z.array(UploadAssetSchema).min(1).max(100000).parse(input);
    if (new Set(assets.map((asset) => asset.path)).size !== assets.length)
      throw new Error("Duplicate asset paths");
    if (await this.store.prefixExists(prefix))
      throw new Error(`R2 prefix already exists: ${prefix}`);
    await parallelMap(assets, this.concurrency, async (asset) => {
      const body = await readPublicationFile(root, asset);
      const key = objectKey(prefix, asset.path);
      await this.store.putIfAbsent(key, body, uploadHeaders(asset));
      await this.verify(prefix, asset);
      // Metadata alone is not proof: independently hash the bytes read back from R2.
      const remote = await this.store.get(key, asset.size);
      if (remote.byteLength !== asset.size || sha256(remote) !== asset.sha256)
        throw new Error(`Uploaded bytes failed checksum verification: ${asset.path}`);
    });
    return assets;
  }

  async verify(prefix: string, asset: UploadAsset): Promise<void> {
    const head = await this.store.head(objectKey(prefix, asset.path));
    const expected = uploadHeaders(asset);
    if (
      head.size !== expected.size ||
      head.sha256 !== expected.sha256 ||
      head.contentType !== expected.contentType ||
      head.cacheControl !== expected.cacheControl
    ) {
      throw new Error(`R2 HEAD validation failed: ${asset.path}`);
    }
  }
}
