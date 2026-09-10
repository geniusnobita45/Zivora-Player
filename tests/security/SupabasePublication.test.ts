// @vitest-environment node
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import type { Database } from "@/lib/supabase/types";
import { SupabasePlaybackCatalog } from "@/services/security/SupabasePlaybackCatalog";
import { PlaybackAuthorization } from "@/services/security/PlaybackAuthorization";
import { SupabasePublicationRepository } from "@/pipeline/publish/SupabasePublicationRepository";
import { version, contentId, episodeId, versionId, prefix, userId } from "./publicationFixture";

function fixture() {
  const transport = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
    );
    const table = url.pathname.split("/").pop();
    const rows: Record<string, unknown> = {
      episodes: { id: episodeId, season_id: versionId, active_media_version_id: versionId },
      seasons: { show_id: versionId },
      shows: { content_id: contentId },
      content: { id: contentId, state: "READY", access_level: "private" },
      media_versions: {
        id: versionId,
        episode_id: episodeId,
        state: "READY",
        published_at: "2026-01-01T00:00:00.000Z",
        storage_access: "private",
        r2_prefix: prefix,
        version_number: 1,
        checksums: { "master.m3u8": "a".repeat(64) },
      },
      manifests: { path: "master.m3u8" },
      reserve_media_version: version,
      publish_media_version: versionId,
      rollback_media_version: versionId,
    };
    return new Response(JSON.stringify(rows[table!] ?? null), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  const client = createClient<Database>("https://supabase.test", "server-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: transport },
  });
  return {
    client,
    transport,
    repository: new SupabasePublicationRepository(client),
    catalog: new SupabasePlaybackCatalog(client),
  };
}
describe("Supabase publication boundaries", () => {
  it("resolves episode ownership and active READY media through typed, filtered queries", async () => {
    const f = fixture();
    const authorization = new PlaybackAuthorization(
      f.catalog,
      {
        sign: async (key) => `https://r2.test/${key}?sig=test`,
        privateUrl: (key) => `https://r2.test/${key}`,
        publicUrl: (key) => `https://public.test/${key}`,
      },
      "s".repeat(32),
    );
    expect(
      await authorization.authorize(
        { id: userId, app_metadata: { content_ids: [contentId] } },
        episodeId,
      ),
    ).toMatchObject({ mediaVersionId: versionId });
    const urls = f.transport.mock.calls.map(([url]) => new URL(String(url)));
    expect(
      urls.find((url) => url.pathname.endsWith("media_versions"))?.searchParams.get("episode_id"),
    ).toBe(`eq.${episodeId}`);
    expect(urls.find((url) => url.pathname.endsWith("content"))?.searchParams.get("state")).toBe(
      "eq.READY",
    );
    expect(urls.find((url) => url.pathname.endsWith("manifests"))?.searchParams.get("kind")).toBe(
      "eq.MASTER",
    );
  });
  it("does not turn lookup errors or missing data into a grant", async () => {
    const f = fixture();
    f.transport.mockResolvedValueOnce(
      new Response("null", { headers: { "Content-Type": "application/json" } }),
    );
    expect(await f.catalog.getEpisode(episodeId)).toBeNull();
    f.transport.mockResolvedValueOnce(
      new Response(JSON.stringify({ message: "denied", code: "42501" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      }),
    );
    await expect(f.catalog.getEpisode(episodeId)).rejects.toThrow("Episode lookup failed");
  });
  it("uses only service publication RPCs and validates returned identities", async () => {
    const f = fixture();
    expect(await f.repository.reserve({ contentId, episodeId })).toEqual(version);
    expect(await f.repository.publish(versionId)).toBe(versionId);
    expect(await f.repository.rollback(episodeId)).toBe(versionId);
    await f.repository.markReady(versionId);
    await f.repository.fail(versionId);
    expect(f.transport.mock.calls.map(([url]) => new URL(String(url)).pathname)).toEqual([
      "/rest/v1/rpc/reserve_media_version",
      "/rest/v1/rpc/publish_media_version",
      "/rest/v1/rpc/rollback_media_version",
      "/rest/v1/rpc/ready_media_version",
      "/rest/v1/rpc/fail_media_version",
    ]);
    f.transport.mockResolvedValueOnce(
      new Response('"not-a-uuid"', { headers: { "Content-Type": "application/json" } }),
    );
    await expect(f.repository.publish(versionId)).rejects.toThrow();
  });
});
