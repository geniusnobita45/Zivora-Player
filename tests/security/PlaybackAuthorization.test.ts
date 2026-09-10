// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { PlaybackAuthorization } from "@/services/security/PlaybackAuthorization";
import { createPlaybackHandler } from "@/services/security/PlaybackRoute";
import { contentId, episodeId, versionId, userId, prefix } from "./publicationFixture";

const user = { id: userId, app_metadata: { content_ids: [contentId] } };
function fixture() {
  let time = 1_800_000_000_000;
  const media = {
    contentId,
    episodeId,
    mediaVersionId: versionId,
    contentState: "READY",
    state: "READY",
    publishedAt: "2026-01-01T00:00:00.000Z",
    access: "private",
    storageAccess: "private",
    prefix,
    versionNumber: 1,
    manifestPath: "master.m3u8",
    checksums: { "master.m3u8": "a".repeat(64), "video/segment.m4s": "b".repeat(64) },
  };
  const catalog = { getEpisode: vi.fn(async () => media) };
  const signer = {
    sign: vi.fn(
      async (key: string, seconds: number) =>
        `https://account.r2.cloudflarestorage.com/private/${key}?expires=${seconds}`,
    ),
    privateUrl: (key: string) => `https://account.r2.cloudflarestorage.com/private/${key}`,
    publicUrl: (key: string) => `https://media.example.com/${key}`,
  };
  const service = new PlaybackAuthorization(catalog, signer, "s".repeat(64), () => time);
  return {
    service,
    signer,
    catalog,
    media,
    advance: (ms: number) => {
      time += ms;
    },
    now: () => time,
  };
}

describe("PlaybackAuthorization", () => {
  it("mints a 10-minute user/version-bound HMAC and signs only that version's objects", async () => {
    const f = fixture();
    const grant = await f.service.authorize(user, episodeId);
    expect(grant.expiresAt).toBe(f.now() + 600_000);
    expect(grant.token).toMatch(/^[\w-]+\.[\w-]+$/);
    const claims = JSON.parse(Buffer.from(grant.token!.split(".")[0], "base64url").toString());
    expect(claims).toMatchObject({
      sub: userId,
      mediaVersionId: versionId,
      episodeId,
      exp: claims.iat + 600,
    });
    f.advance(120_000);
    const objects = await f.service.signObjects(user, grant.token, ["video/segment.m4s"]);
    expect(objects.urls["video/segment.m4s"]).toContain("expires=480");
    expect(f.signer.sign).toHaveBeenLastCalledWith(`${prefix}video/segment.m4s`, 480);
  });
  it("allows unsigned public playback without a user", async () => {
    const f = fixture();
    f.media.access = f.media.storageAccess = "public";
    expect(await f.service.authorize(null, episodeId)).toMatchObject({
      access: "public",
      token: null,
      expiresAt: null,
      manifestUrl: `https://media.example.com/${prefix}master.m3u8`,
    });
    expect(f.signer.sign).not.toHaveBeenCalled();
  });
  it.each([null, { id: userId }, { id: userId, user_metadata: { content_ids: [contentId] } }])(
    "denies missing auth or user-editable entitlements: %j",
    async (input) => {
      await expect(fixture().service.authorize(input, episodeId)).rejects.toMatchObject({
        status: input === null ? 401 : 403,
      });
    },
  );
  it.each(["PROCESSING", "VALIDATING", "FAILED"])("hides %s media", async (state) => {
    const f = fixture();
    f.media.state = state;
    await expect(f.service.authorize(user, episodeId)).rejects.toMatchObject({ status: 404 });
    expect(f.signer.sign).not.toHaveBeenCalled();
  });
  it("hides unpublished, cross-episode and storage-mismatched media", async () => {
    for (const patch of [
      { publishedAt: "" },
      { contentState: "UPLOADED" },
      { storageAccess: "public" },
      { episodeId: userId },
      { prefix: prefix.replace("v1", "v2") },
    ]) {
      const f = fixture();
      Object.assign(f.media, patch);
      await expect(f.service.authorize(user, episodeId)).rejects.toMatchObject({ status: 404 });
    }
  });
  it("rejects forgery, cross-user replay and expiration", async () => {
    const f = fixture();
    const grant = await f.service.authorize(user, episodeId);
    await expect(
      f.service.signObjects(user, `${grant.token}x`, ["master.m3u8"]),
    ).rejects.toMatchObject({ status: 401 });
    await expect(f.service.renew({ ...user, id: episodeId }, grant.token)).rejects.toMatchObject({
      status: 401,
    });
    f.advance(600_000);
    await expect(f.service.renew(user, grant.token)).rejects.toMatchObject({ status: 401 });
  });
  it("denies traversal, unsigned objects and revoked entitlements", async () => {
    const f = fixture();
    const grant = await f.service.authorize(user, episodeId);
    for (const path of ["../secret", "/etc/passwd", "%2e%2e/secret", "https://other/secret"])
      await expect(f.service.signObjects(user, grant.token, [path])).rejects.toThrow();
    await expect(
      f.service.signObjects(user, grant.token, ["not-registered.m4s"]),
    ).rejects.toMatchObject({ status: 403 });
    await expect(f.service.renew({ ...user, app_metadata: {} }, grant.token)).rejects.toMatchObject(
      { status: 403 },
    );
  });
  it("renews the existing immutable version, independent of a changed active pointer", async () => {
    const f = fixture();
    const grant = await f.service.authorize(user, episodeId);
    f.advance(540_000);
    const renewed = await f.service.renew(user, grant.token);
    expect(f.catalog.getEpisode).toHaveBeenLastCalledWith(episodeId, versionId);
    expect(renewed.mediaVersionId).toBe(versionId);
    expect(renewed.expiresAt).toBe(f.now() + 600_000);
    expect(renewed.token).not.toBe(grant.token);
  });
});

describe("playback metadata route", () => {
  const request = (body: unknown, headers: Record<string, string> = {}) =>
    new Request("https://zivora.test/api/playback", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
  it("returns no-store JSON, never video, with server-verified identity", async () => {
    const f = fixture();
    const authenticate = vi.fn(async () => user);
    const handle = createPlaybackHandler({ authorization: () => f.service, authenticate });
    const response = await handle(request({ action: "authorize", episodeId }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(await response.json()).toMatchObject({ mediaVersionId: versionId });
    expect(authenticate).toHaveBeenCalledOnce();
  });
  it("rejects user-injected claims, oversized bodies and cross-origin requests before dependencies", async () => {
    const authorization = vi.fn();
    const authenticate = vi.fn();
    const handle = createPlaybackHandler({ authorization, authenticate });
    expect((await handle(request({ action: "authorize", episodeId, user }))).status).toBe(400);
    expect((await handle(request("x".repeat(17_000)))).status).toBe(400);
    expect((await handle(request({}, { Origin: "https://evil.test" }))).status).toBe(403);
    expect(authorization).not.toHaveBeenCalled();
    expect(authenticate).not.toHaveBeenCalled();
  });
  it("sanitizes infrastructure failures and preserves authorization status codes", async () => {
    const f = fixture();
    const handle = createPlaybackHandler({
      authorization: () => f.service,
      authenticate: async () => null,
    });
    expect((await handle(request({ action: "authorize", episodeId }))).status).toBe(401);
    f.catalog.getEpisode.mockRejectedValueOnce(new Error("secret credential"));
    const failure = await handle(request({ action: "authorize", episodeId }));
    expect(failure.status).toBe(503);
    expect(await failure.text()).not.toContain("secret");
  });
});
