// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { PlaybackRequestAuthorization } from "@/services/security/PlaybackRequestAuthorization";
import { contentId, episodeId, versionId, prefix } from "./publicationFixture";

function fixture() {
  let time = 1_800_000_000_000;
  const base = `https://account.r2.cloudflarestorage.com/private/${prefix}`;
  const grant = {
    access: "private" as const,
    contentId,
    episodeId,
    mediaVersionId: versionId,
    manifestUrl: `${base}master.m3u8?sig=initial`,
    objectBaseUrl: base,
    token: "initial.token",
    expiresAt: time + 600_000,
  };
  const transport = vi.fn(async (body: unknown): Promise<unknown> => {
    const request = body as { action: string; paths?: string[] };
    if (request.action === "renew")
      return { ...grant, token: "new.token", expiresAt: time + 600_000 };
    return {
      urls: Object.fromEntries(request.paths!.map((path) => [path, `${base}${path}?sig=fresh`])),
      expiresAt: time + 600_000,
    };
  });
  const session = new PlaybackRequestAuthorization(grant, transport, () => time);
  return {
    session,
    transport,
    grant,
    base,
    advance: (ms: number) => {
      time += ms;
    },
  };
}
describe("adapter playback URL authorization", () => {
  it("uses the initial signed master and signs/caches child objects without sending media through the API", async () => {
    const f = fixture();
    expect(
      await f.session.authorizeRequest({ type: "manifest", uris: [f.grant.manifestUrl] }),
    ).toEqual({ uris: [f.grant.manifestUrl] });
    expect(f.transport).not.toHaveBeenCalled();
    const request = { type: "segment" as const, uris: [`${f.base}video/first.m4s`] };
    expect(await f.session.authorizeRequest(request)).toEqual({
      uris: [`${f.base}video/first.m4s?sig=fresh`],
    });
    await f.session.authorizeRequest(request);
    expect(f.transport).toHaveBeenCalledOnce();
    expect(f.transport).toHaveBeenCalledWith({
      action: "sign",
      token: "initial.token",
      paths: ["video/first.m4s"],
    });
  });
  it("deduplicates renewal across simultaneous requests before token expiry", async () => {
    const f = fixture();
    f.advance(540_000);
    await Promise.all(
      ["a.m4s", "b.m4s"].map((path) =>
        f.session.authorizeRequest({ type: "segment", uris: [`${f.base}${path}`] }),
      ),
    );
    expect(
      f.transport.mock.calls.filter(([body]) => (body as { action: string }).action === "renew"),
    ).toHaveLength(1);
    expect(f.transport).toHaveBeenCalledWith({
      action: "sign",
      token: "new.token",
      paths: ["a.m4s"],
    });
  });
  it("rejects foreign origins, versions and encoded paths before calling the signer", async () => {
    const f = fixture();
    for (const uri of [
      "https://evil.test/segment.m4s",
      `${f.base.replace("v1", "v2")}segment.m4s`,
      `${f.base}%2fprivate.m4s`,
    ])
      await expect(f.session.authorizeRequest({ type: "segment", uris: [uri] })).rejects.toThrow();
    expect(f.transport).not.toHaveBeenCalled();
  });
  it("rejects signer substitution and unauthorized version changes on renewal", async () => {
    const f = fixture();
    f.transport.mockResolvedValueOnce({
      urls: { "s.m4s": "https://evil.test/s.m4s" },
      expiresAt: f.grant.expiresAt,
    });
    await expect(
      f.session.authorizeRequest({ type: "segment", uris: [`${f.base}s.m4s`] }),
    ).rejects.toThrow("outside");
    f.advance(540_000);
    f.transport.mockResolvedValueOnce({
      ...f.grant,
      mediaVersionId: episodeId,
      expiresAt: f.grant.expiresAt + 600_000,
    });
    await expect(
      f.session.authorizeRequest({ type: "manifest", uris: [f.grant.manifestUrl] }),
    ).rejects.toThrow("renewal");
  });
  it("keeps DRM license authorization separate and bypasses signing for public media", async () => {
    const f = fixture();
    expect(
      await f.session.authorizeRequest({ type: "license", uris: ["https://drm.test/license"] }),
    ).toBeUndefined();
    const publicSession = new PlaybackRequestAuthorization(
      { ...f.grant, access: "public", token: null, expiresAt: null },
      f.transport,
    );
    expect(
      await publicSession.authorizeRequest({ type: "segment", uris: [`${f.base}s.m4s`] }),
    ).toBeUndefined();
    expect(f.transport).not.toHaveBeenCalled();
  });
});
