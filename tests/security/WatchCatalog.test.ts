// @vitest-environment node
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import type { Database } from "@/lib/supabase/types";
import { WatchCatalog } from "@/services/security/WatchCatalog";
import { PlaybackAuthorization } from "@/services/security/PlaybackAuthorization";
import { createPlaybackHandler } from "@/services/security/PlaybackRoute";
import { versionPrefix } from "@/lib/r2/paths";
import { contentId, episodeId, versionId, userId } from "./publicationFixture";

const season1 = "55555555-5555-4555-8555-555555555555";
const season2 = "66666666-6666-4666-8666-666666666666";
const nextId = "77777777-7777-4777-8777-777777777777";
function fixture(movie = false) {
  const calls: URL[] = [];
  const active = { id: versionId, state: "READY", published_at: "2026-09-08T00:00:00.000Z" };
  const transport = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    calls.push(url);
    const table = url.pathname.split("/").pop();
    let data: unknown;
    if (table === "content")
      data = {
        id: contentId,
        title: "The Quiet Horizon",
        active_media_version_id: movie ? versionId : null,
      };
    else if (table === "media_versions") data = active;
    else if (table === "shows") data = { id: versionId };
    else if (table === "seasons")
      data = [
        { id: season1, season_number: 1 },
        { id: season2, season_number: 2 },
      ];
    else if (table === "episodes") {
      const current = {
        id: episodeId,
        title: "Arrival",
        season_id: season1,
        order_index: 8,
        active,
      };
      const next = { id: nextId, title: "A New Shore", season_id: season2, order_index: 1, active };
      data = url.searchParams.has("id")
        ? current
        : url.searchParams.get("season_id") === `eq.${season2}`
          ? [next]
          : url.searchParams.has("order_index")
            ? []
            : [current];
    }
    return new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });
  });
  const client = createClient<Database>("https://supabase.test", "service-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: transport },
  });
  return { catalog: new WatchCatalog(client), transport, calls };
}
describe("watch catalog boundaries", () => {
  it("resolves content-level media without leaking storage paths", async () => {
    const f = fixture(true);
    const result = await f.catalog.select(contentId);
    expect(result).toEqual({
      current: { contentId, episodeId: null, title: "The Quiet Horizon", description: "" },
      next: null,
    });
    expect(f.calls[0].searchParams.get("state")).toBe("eq.READY");
  });
  it("resolves the first published episode and the next one across season boundaries", async () => {
    const f = fixture();
    const result = await f.catalog.select(contentId);
    expect(result.current.episodeId).toBe(episodeId);
    expect(result.next?.episodeId).toBe(nextId);
    const episodeQueries = f.calls.filter((url) => url.pathname.endsWith("episodes"));
    expect(episodeQueries.every((url) => url.searchParams.get("active.state") === "eq.READY")).toBe(
      true,
    );
    expect(
      episodeQueries.every((url) => url.searchParams.get("active.published_at") === "not.is.null"),
    ).toBe(true);
  });
  it("resolves a requested episode and rejects missing or foreign titles", async () => {
    const f = fixture();
    expect((await f.catalog.select(contentId, episodeId)).next?.episodeId).toBe(nextId);
    f.transport.mockResolvedValueOnce(
      new Response("null", { headers: { "Content-Type": "application/json" } }),
    );
    await expect(f.catalog.select(contentId)).rejects.toMatchObject({ status: 404 });
  });
  it("serves only validated catalog JSON before constructing any R2 signer", async () => {
    const f = fixture();
    const authorization = vi.fn();
    const authenticate = vi.fn();
    const handler = createPlaybackHandler({
      authorization,
      authenticate,
      catalog: (id, episode) => f.catalog.select(id, episode),
    });
    const response = await handler(
      new Request("https://zivora.test/api/playback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "catalog", contentId }),
      }),
    );
    expect(response.status).toBe(200);
    expect((await response.json()).next.episodeId).toBe(nextId);
    expect(authorization).not.toHaveBeenCalled();
    expect(authenticate).not.toHaveBeenCalled();
  });
  it("binds content-only HMAC grants and renewal to content ownership", async () => {
    const media = {
      contentId,
      episodeId: null,
      mediaVersionId: versionId,
      contentState: "READY",
      state: "READY",
      publishedAt: "2026-09-08T00:00:00.000Z",
      access: "private",
      storageAccess: "private",
      prefix: versionPrefix(contentId, null, 1),
      versionNumber: 1,
      manifestPath: "master.m3u8",
      checksums: { "master.m3u8": "a".repeat(64) },
    };
    const getContent = vi.fn(async () => media);
    const service = new PlaybackAuthorization(
      { getEpisode: async () => null, getContent },
      {
        sign: async (key) => `https://r2.test/${key}?signed=1`,
        privateUrl: (key) => `https://r2.test/${key}`,
        publicUrl: (key) => `https://public.test/${key}`,
      },
      "s".repeat(64),
    );
    const user = { id: userId, app_metadata: { content_ids: [contentId] } };
    const grant = await service.authorizeContent(user, contentId);
    expect(grant.episodeId).toBeNull();
    expect((await service.renew(user, grant.token)).mediaVersionId).toBe(versionId);
    expect(getContent).toHaveBeenLastCalledWith(contentId, versionId);
    await expect(service.authorizeContent(user, nextId)).rejects.toMatchObject({ status: 404 });
  });
});
