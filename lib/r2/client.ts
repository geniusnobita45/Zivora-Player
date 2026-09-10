import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import {
  S3Client,
  ListObjectsV2Command,
  PutObjectCommand,
  HeadObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { z } from "zod";
import { ObjectPathSchema, Sha256Schema } from "./paths";
import type { ObjectHeaders, ObjectStore } from "./ObjectStore";

const EnvSchema = z.object({
  R2_ACCOUNT_ID: z.string().regex(/^[a-f0-9]{32}$/),
  R2_ACCESS_KEY_ID: z.string().min(1),
  R2_SECRET_ACCESS_KEY: z.string().min(1),
  R2_BUCKET_NAME: z.string().regex(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/),
  R2_PUBLIC_BUCKET_NAME: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/)
    .optional(),
  R2_PUBLIC_BASE_URL: z.string().url().optional(),
});
const HeadersSchema = z.object({
  size: z.number().int().positive(),
  contentType: z.string().min(1),
  cacheControl: z.string().min(1),
  sha256: Sha256Schema,
});
export const MAX_OBJECT_BYTES = 128 * 1024 * 1024;

export class R2ObjectStore implements ObjectStore {
  constructor(
    readonly client: S3Client,
    readonly bucket: string,
    readonly endpoint: string,
  ) {}

  async prefixExists(prefix: string): Promise<boolean> {
    ObjectPathSchema.parse(prefix.replace(/\/$/, ""));
    const result = await this.client.send(
      new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, MaxKeys: 1 }),
    );
    return z.number().int().nonnegative().parse(result.KeyCount) > 0;
  }
  async putIfAbsent(key: string, body: Uint8Array, input: ObjectHeaders): Promise<void> {
    ObjectPathSchema.parse(key);
    const headers = HeadersSchema.parse(input);
    if (headers.size !== body.byteLength || body.byteLength > MAX_OBJECT_BYTES)
      throw new Error("Invalid object size");
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        IfNoneMatch: "*",
        ContentLength: body.byteLength,
        ContentType: headers.contentType,
        CacheControl: headers.cacheControl,
        ContentMD5: createHash("md5").update(body).digest("base64"),
        Metadata: { sha256: headers.sha256 },
      }),
    );
  }
  async head(key: string): Promise<ObjectHeaders> {
    const result = await this.client.send(
      new HeadObjectCommand({ Bucket: this.bucket, Key: ObjectPathSchema.parse(key) }),
    );
    return HeadersSchema.parse({
      size: result.ContentLength,
      contentType: result.ContentType,
      cacheControl: result.CacheControl,
      sha256: result.Metadata?.sha256,
    });
  }
  async get(key: string, maxBytes = MAX_OBJECT_BYTES): Promise<Uint8Array> {
    z.number().int().positive().max(MAX_OBJECT_BYTES).parse(maxBytes);
    const result = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: ObjectPathSchema.parse(key) }),
    );
    if (!result.Body) throw new Error("R2 returned no object body");
    try {
      const size = z.number().int().positive().max(maxBytes).parse(result.ContentLength);
      const chunks: Uint8Array[] = [];
      let received = 0;
      // Streaming enforces a hard bound even when remote Content-Length is wrong.
      for await (const chunk of result.Body as AsyncIterable<Uint8Array>) {
        received += chunk.byteLength;
        if (received > maxBytes) throw new Error("R2 object exceeds the byte limit");
        chunks.push(chunk);
      }
      if (received !== size) throw new Error("Truncated R2 object");
      return Buffer.concat(chunks);
    } finally {
      if (result.Body instanceof Readable) result.Body.destroy();
    }
  }
  objectUrl(key: string): string {
    return `${this.endpoint}/${this.bucket}/${ObjectPathSchema.parse(key)}`;
  }
  async signedUrl(key: string, expiresIn: number): Promise<string> {
    z.number().int().min(1).max(600).parse(expiresIn);
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: ObjectPathSchema.parse(key) }),
      { expiresIn },
    );
  }
}

export function createR2Storage(environment: Record<string, string | undefined> = process.env) {
  const config = EnvSchema.parse(environment);
  if (config.R2_PUBLIC_BUCKET_NAME === config.R2_BUCKET_NAME)
    throw new Error("Public and private R2 buckets must differ");
  const endpoint = `https://${config.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  const client = new S3Client({
    region: "auto",
    endpoint,
    forcePathStyle: true,
    maxAttempts: 3,
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
    credentials: {
      accessKeyId: config.R2_ACCESS_KEY_ID,
      secretAccessKey: config.R2_SECRET_ACCESS_KEY,
    },
  });
  const privateStore = new R2ObjectStore(client, config.R2_BUCKET_NAME, endpoint);
  return {
    privateStore,
    forAccess(access: "public" | "private"): R2ObjectStore {
      if (access === "private") return privateStore;
      if (!config.R2_PUBLIC_BUCKET_NAME || !config.R2_PUBLIC_BASE_URL)
        throw new Error("Public R2 bucket and URL are required for public media");
      return new R2ObjectStore(client, config.R2_PUBLIC_BUCKET_NAME, endpoint);
    },
    publicUrl(key: string): string {
      if (!config.R2_PUBLIC_BUCKET_NAME || !config.R2_PUBLIC_BASE_URL)
        throw new Error("Public R2 storage is unconfigured");
      const base = new URL(config.R2_PUBLIC_BASE_URL);
      if (base.protocol !== "https:" || base.search || base.hash || base.username || base.password)
        throw new Error("Invalid public R2 origin");
      return `${base.href.replace(/\/$/, "")}/${ObjectPathSchema.parse(key)}`;
    },
  };
}
