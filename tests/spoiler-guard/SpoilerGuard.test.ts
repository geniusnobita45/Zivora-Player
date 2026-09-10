import { describe, expect, it } from "vitest";
import { SpoilerGuard, computeWatchBoundary } from "@/features/ai/spoiler-guard";
import { resolveWatchState } from "@/features/ai/orchestrator/WatchStateResolver";
import { uid } from "../ai/fixtures";
describe("spoiler guard", () => {
  const state = {
    currentEpisodeOrder: 1,
    currentPosition: 20,
    furthestEpisodeOrder: 3,
    furthestPosition: 40,
  };
  const boundary = { boundary_episode_order: 1, boundary_seconds: 20 };
  it("distinguishes current playback from watched knowledge", () => {
    expect(computeWatchBoundary(state, "strict_current")).toEqual(boundary);
    expect(computeWatchBoundary(state, "watched_knowledge")).toEqual({
      boundary_episode_order: 3,
      boundary_seconds: 40,
    });
  });
  it("accepts exact end boundary and earlier episodes, rejects overlapping and future intervals", () => {
    const guard = new SpoilerGuard();
    const safe = [
      { episode_order: 0, start_s: 0, end_s: 100 },
      { episode_order: 1, start_s: 10, end_s: 20 },
    ];
    expect(guard.assertSafe(safe, boundary)).toEqual(safe);
    for (const row of [
      { episode_order: 1, start_s: 10, end_s: 20.00001 },
      { episode_order: 2, start_s: 0, end_s: 1 },
    ])
      expect(() => guard.assertSafe([row], boundary)).toThrow("spoiler boundary");
  });
  it("rejects malformed state and disregards a forged furthest position", () => {
    expect(() =>
      computeWatchBoundary({ ...state, currentPosition: NaN }, "strict_current"),
    ).toThrow();
    const resolved = resolveWatchState(
      { ...state, currentEpisodeOrder: 0, furthestEpisodeOrder: 999 },
      null,
      [{ episode_id: null, episode_order: 0, media_version_id: uid(3), duration_s: 100 }],
      [{ episode_id: null, furthest_position_s: 35 }],
    );
    expect(resolved.state.furthestEpisodeOrder).toBe(0);
    expect(resolved.state.furthestPosition).toBe(35);
  });
});
