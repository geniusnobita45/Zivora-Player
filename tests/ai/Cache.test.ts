// @vitest-environment node
import { describe, expect, it, vi, afterEach } from "vitest";
import { AICache, cacheKey, normalizeQuestion } from "@/features/ai/cache/AICache";
import { request, authorization, uid } from "./fixtures";
const boundary = { boundary_episode_order: 0, boundary_seconds: 30 };
afterEach(() => vi.useRealTimers());
describe("AI cache isolation", () => {
  it("continues when optional cache storage hangs", async () => {
    vi.useFakeTimers();
    const cache = new AICache({
      get: () => new Promise(() => {}),
      put: () => new Promise(() => {}),
    });
    const read = cache.get("key", uid(2));
    await vi.advanceTimersByTimeAsync(501);
    expect(await read).toBeNull();
    const write = cache.put("key", uid(2), { answer: "Safe", confidence: 0, candidates: [] });
    await vi.advanceTimersByTimeAsync(501);
    await expect(write).resolves.toBeUndefined();
  });
  it("normalizes Unicode, case and whitespace without destroying question meaning", () => {
    expect(normalizeQuestion("  ＦＩＮＤ\n The   Scene  ")).toBe("find the scene");
    expect(normalizeQuestion("Who isn't Sam?")).not.toBe(normalizeQuestion("Who is Sam?"));
    expect(
      cacheKey(
        { ...request, question: " FIND   THE LIGHTHOUSE SCENE " },
        authorization,
        "find_scene",
        boundary,
      ),
    ).toBe(cacheKey(request, authorization, "find_scene", boundary));
  });
  it("isolates exact spoiler times, owners, versions, modes, language, filters, and episodes", () => {
    const key = cacheKey(request, authorization, "find_scene", boundary);
    const variants = [
      cacheKey(request, authorization, "find_scene", { ...boundary, boundary_seconds: 31 }),
      cacheKey(request, { ...authorization, userId: uid(9) }, "find_scene", boundary),
      cacheKey(request, { ...authorization, mediaVersionIds: [uid(9)] }, "find_scene", boundary),
      cacheKey({ ...request, language: "fr" }, authorization, "find_scene", boundary),
      cacheKey({ ...request, mode: "watched_knowledge" }, authorization, "find_scene", boundary),
      cacheKey({ ...request, episodeId: uid(8) }, authorization, "find_scene", boundary),
      cacheKey(
        { ...request, filters: { character_id: uid(6) } },
        authorization,
        "find_scene",
        boundary,
      ),
    ];
    expect(variants.every((value) => value !== key)).toBe(true);
  });
  it("treats malformed cache data and failures as misses and writes a bounded TTL", async () => {
    const put = vi.fn(async () => {});
    const cache = new AICache(
      { get: async () => ({ answer: "poison", command: { type: "PLAY" } }), put },
      () => 1000,
    );
    expect(await cache.get("key", uid(2))).toBeNull();
    await cache.put("key", uid(2), { answer: "Safe", confidence: 0, candidates: [] }, 30);
    expect(put).toHaveBeenCalledWith(
      "key",
      uid(2),
      expect.any(Object),
      new Date(31000).toISOString(),
    );
  });
});
