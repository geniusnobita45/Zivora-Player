// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: mocks.create }));
import { playbackRepository } from "@/lib/supabase/playback";
const userId = "11111111-1111-4111-8111-111111111111",
  contentId = "22222222-2222-4222-8222-222222222222";
const record = {
  userId,
  contentId,
  episodeId: null,
  position: 10,
  duration: 100,
  furthestPosition: 50,
  updatedAt: "2026-09-09T00:00:00.000Z",
  sessionId: null,
};
const row = {
  user_id: userId,
  content_id: contentId,
  episode_id: null,
  position_s: 10,
  duration_s: 100,
  furthest_position_s: 50,
  updated_at: record.updatedAt,
};
function fixture() {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    is: vi.fn(),
    order: vi.fn(),
    upsert: vi.fn(),
    single: vi.fn(),
    maybeSingle: vi.fn(),
    limit: vi.fn(),
  };
  for (const key of ["select", "eq", "is", "order", "upsert"] as const)
    query[key].mockReturnValue(query);
  query.single.mockResolvedValue({ data: row, error: null });
  query.maybeSingle.mockResolvedValue({ data: row, error: null });
  const auth = { getUser: vi.fn(async () => ({ data: { user: { id: userId } }, error: null })) };
  const db = { auth, from: vi.fn(() => query), rpc: vi.fn(() => query) };
  mocks.create.mockResolvedValue(db);
  return { query, db };
}
beforeEach(() => vi.clearAllMocks());
describe("caller-scoped Supabase playback repository", () => {
  it("does not construct privileged or anonymous write clients", async () => {
    expect(await playbackRepository(new Request("https://zivora.test/api/progress"))).toBeNull();
    expect(
      await playbackRepository(
        new Request("https://zivora.test/api/progress", {
          headers: { Authorization: "Basic invalid" },
        }),
      ),
    ).toBeNull();
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("uses the same bearer token for authentication and RLS and maps the RPC response", async () => {
    const f = fixture(),
      repository = (await playbackRepository(
        new Request("https://zivora.test/api/progress", {
          headers: { Authorization: "Bearer aaa.bbb.ccc" },
        }),
      ))!;
    expect(mocks.create).toHaveBeenCalledWith("aaa.bbb.ccc");
    expect(f.db.auth.getUser).toHaveBeenCalledWith("aaa.bbb.ccc");
    expect(await repository.saveProgress(record)).toEqual(record);
    expect(f.db.rpc).toHaveBeenCalledWith("upsert_progress", {
      p_content_id: contentId,
      p_episode_id: null,
      p_position_s: 10,
      p_duration_s: 100,
      p_furthest_position_s: 50,
      p_updated_at: record.updatedAt,
      p_session_id: null,
    });
    expect(await repository.getProgress(record)).toEqual(record);
    expect(f.query.eq).toHaveBeenCalledWith("user_id", userId);
    expect(f.query.is).toHaveBeenCalledWith("episode_id", null);
  });
  it("maps bookmark tombstones and refuses malformed database acknowledgements", async () => {
    const f = fixture(),
      repository = (await playbackRepository(
        new Request("https://zivora.test/api/bookmarks", {
          headers: { Cookie: "session=fixture" },
        }),
      ))!;
    const id = "33333333-3333-4333-8333-333333333333",
      value = {
        id,
        userId,
        contentId,
        episodeId: null,
        position: 10,
        title: "Saved",
        deleted: true,
        updatedAt: record.updatedAt,
      };
    f.query.single.mockResolvedValueOnce({
      data: { ...row, id, title: "Saved", deleted: true },
      error: null,
    });
    expect(await repository.saveBookmark(value)).toEqual(value);
    expect(f.query.upsert).toHaveBeenCalledWith(
      {
        id,
        user_id: userId,
        content_id: contentId,
        episode_id: null,
        position_s: 10,
        title: "Saved",
        deleted: true,
        updated_at: record.updatedAt,
      },
      { onConflict: "id" },
    );
    f.query.single.mockResolvedValueOnce({ data: { ...row, position_s: "bad" }, error: null });
    await expect(repository.saveProgress(record)).rejects.toThrow();
  });
});
