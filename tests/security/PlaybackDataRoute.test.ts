// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  createPlaybackDataHandler,
  type PlaybackDataRepository,
} from "@/services/security/PlaybackDataRoute";
const userId = "11111111-1111-4111-8111-111111111111",
  contentId = "22222222-2222-4222-8222-222222222222";
const progress = {
  userId,
  contentId,
  episodeId: null,
  sessionId: null,
  position: 20,
  duration: 100,
  furthestPosition: 90,
  updatedAt: "2026-09-09T00:00:00.000Z",
};
const bookmark = {
  userId,
  contentId,
  episodeId: null,
  id: "33333333-3333-4333-8333-333333333333",
  position: 20,
  title: "Moment",
  updatedAt: progress.updatedAt,
  deleted: false,
};
function setup(kind: "progress" | "bookmarks" = "progress") {
  const repository: PlaybackDataRepository = {
    userId,
    getProgress: vi.fn(async () => progress),
    saveProgress: vi.fn(async () => progress),
    listBookmarks: vi.fn(async () => [bookmark]),
    saveBookmark: vi.fn(async () => bookmark),
  };
  const auth = vi.fn(async (): Promise<PlaybackDataRepository | null> => repository);
  return { repository, auth, handler: createPlaybackDataHandler(kind, auth) };
}
const post = (value: unknown, headers: Record<string, string> = {}) =>
  new Request("https://zivora.test/api/progress", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(value),
  });
describe("authenticated playback data routes", () => {
  it("requires authentication and independently rejects a spoofed owner", async () => {
    const f = setup();
    f.auth.mockResolvedValueOnce(null);
    expect((await f.handler(post(progress))).status).toBe(401);
    expect((await f.handler(post({ ...progress, userId: contentId }))).status).toBe(403);
    expect(f.repository.saveProgress).not.toHaveBeenCalled();
  });
  it("rejects cross-origin, malformed, oversized, unknown and invalid input", async () => {
    const f = setup();
    expect((await f.handler(post(progress, { Origin: "https://evil.test" }))).status).toBe(403);
    for (const body of [
      { ...progress, position: -1 },
      { ...progress, extra: true },
      { ...progress, duration: 100000 },
      { ...progress, furthestPosition: 2 },
      { ...progress, userId: "bad" },
    ])
      expect((await f.handler(post(body))).status).toBe(400);
    expect(
      (
        await f.handler(
          new Request("https://zivora.test/api/progress", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "{",
          }),
        )
      ).status,
    ).toBe(400);
    expect((await f.handler(post({ data: "x".repeat(17000) }))).status).toBe(400);
    expect(f.auth).not.toHaveBeenCalled();
  });
  it("returns authoritative acknowledgements with private no-store headers", async () => {
    const f = setup(),
      response = await f.handler(post(progress));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ progress });
    expect(response.headers.get("cache-control")).toContain("no-store");
    const get = await f.handler(
      new Request(`https://zivora.test/api/progress?contentId=${contentId}`),
    );
    expect(get.status).toBe(200);
    expect(f.repository.getProgress).toHaveBeenCalledWith({ contentId, episodeId: null });
  });
  it("never echoes backend failures or another user's response", async () => {
    const f = setup();
    vi.mocked(f.repository.saveProgress).mockRejectedValueOnce(new Error("secret credential"));
    const response = await f.handler(post(progress));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("secret");
    vi.mocked(f.repository.saveProgress).mockResolvedValueOnce({ ...progress, userId: contentId });
    expect((await f.handler(post(progress))).status).toBe(503);
  });
  it("lists bookmark tombstones and validates persisted mutation responses", async () => {
    const f = setup("bookmarks");
    expect((await f.handler(post(bookmark))).status).toBe(200);
    const response = await f.handler(
      new Request(`https://zivora.test/api/bookmarks?contentId=${contentId}`),
    );
    expect(await response.json()).toEqual({ bookmarks: [bookmark] });
    vi.mocked(f.repository.saveBookmark).mockResolvedValueOnce({ ...bookmark, id: contentId });
    expect((await f.handler(post(bookmark))).status).toBe(503);
  });
});
