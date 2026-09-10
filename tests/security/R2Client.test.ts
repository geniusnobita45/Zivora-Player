// @vitest-environment node
import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { createR2Storage } from "@/lib/r2/client";
import { sha256 } from "@/pipeline/publish/R2Uploader";
import { prefix } from "./publicationFixture";

const environment = {
  R2_ACCOUNT_ID: "a".repeat(32),
  R2_ACCESS_KEY_ID: "test-access",
  R2_SECRET_ACCESS_KEY: "test-secret",
  R2_BUCKET_NAME: "private-media",
  R2_PUBLIC_BUCKET_NAME: "public-media",
  R2_PUBLIC_BASE_URL: "https://media.test",
};
// Narrow the SDK's overloaded callback/promise signatures to the promise boundary under test.
const spySend = (client: unknown) =>
  vi.spyOn(client as { send: (command: { input: unknown }) => Promise<unknown> }, "send");
describe("R2 S3 boundary", () => {
  it("performs create-only uploads with length, checksum and cache headers", async () => {
    const store = createR2Storage(environment).privateStore;
    const send = spySend(store.client).mockResolvedValue({});
    const body = Buffer.from("bytes");
    await store.putIfAbsent(`${prefix}s.m4s`, body, {
      size: body.length,
      sha256: sha256(body),
      contentType: "video/iso.segment",
      cacheControl: "public, max-age=31536000, immutable",
    });
    const command = send.mock.calls[0][0] as { input: Record<string, unknown> };
    expect(command.input).toMatchObject({
      IfNoneMatch: "*",
      Bucket: "private-media",
      Key: `${prefix}s.m4s`,
      ContentLength: 5,
      Metadata: { sha256: sha256(body) },
    });
    expect(command.input.ContentMD5).toBeTypeOf("string");
    store.client.destroy();
  });
  it("signs a direct object GET for at most 10 minutes without permanent credentials in the URL", async () => {
    const storage = createR2Storage(environment);
    const url = new URL(await storage.privateStore.signedUrl(`${prefix}master.m3u8`, 600));
    expect(url.hostname).toBe(`${environment.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`);
    expect(url.pathname).toBe(`/private-media/${prefix}master.m3u8`);
    expect(url.searchParams.get("X-Amz-Expires")).toBe("600");
    expect(url.href).not.toContain(environment.R2_SECRET_ACCESS_KEY);
    await expect(storage.privateStore.signedUrl(`${prefix}s.m4s`, 601)).rejects.toThrow();
    expect(storage.forAccess("public").bucket).toBe("public-media");
    expect(storage.publicUrl(`${prefix}master.m3u8`)).toBe(
      `https://media.test/${prefix}master.m3u8`,
    );
    storage.privateStore.client.destroy();
  });
  it("rejects public/private bucket sharing and unconfigured public storage", () => {
    expect(() =>
      createR2Storage({ ...environment, R2_PUBLIC_BUCKET_NAME: "private-media" }),
    ).toThrow("differ");
    const storage = createR2Storage({ ...environment, R2_PUBLIC_BUCKET_NAME: undefined });
    expect(() => storage.forAccess("public")).toThrow("required");
    storage.privateStore.client.destroy();
  });
  it("validates HEAD responses and detects truncated or over-limit object bodies", async () => {
    const store = createR2Storage(environment).privateStore;
    const send = spySend(store.client);
    send.mockResolvedValueOnce({
      ContentLength: 2,
      ContentType: "video/mp4",
      CacheControl: "immutable",
      Metadata: { sha256: "bad" },
    });
    await expect(store.head(`${prefix}s.m4s`)).rejects.toThrow();
    send.mockResolvedValueOnce({ ContentLength: 3, Body: Readable.from([Buffer.from("ab")]) });
    await expect(store.get(`${prefix}s.m4s`, 3)).rejects.toThrow("Truncated");
    send.mockResolvedValueOnce({ ContentLength: 2, Body: Readable.from([Buffer.from("abcd")]) });
    await expect(store.get(`${prefix}s.m4s`, 2)).rejects.toThrow("byte limit");
    send.mockResolvedValueOnce({ ContentLength: 2, Body: Readable.from([Buffer.from("ab")]) });
    expect(await store.get(`${prefix}s.m4s`, 2)).toEqual(Buffer.from("ab"));
    store.client.destroy();
  });
});
