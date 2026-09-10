// @vitest-environment node
import { describe, expect, it } from "vitest";
import { rankRecommendations, recommendationCacheKey } from "@/features/recommendations";
import { uid } from "./fixtures";
const item = (id: string, title: string) => ({
  id,
  type: "movie" as const,
  title,
  synopsis: null,
  release_date: null,
  runtime_seconds: 100,
  active_media_version_id: uid(90),
  created_at: null,
  updated_at: null,
});
describe("recommendation ranking", () => {
  it("excludes watched titles and boosts matching genres and semantic scores", () => {
    const result = rankRecommendations(
      [item(uid(1), "Watched"), item(uid(2), "Drama"), item(uid(3), "Vector")],
      {
        history: [{ contentId: uid(1), genres: ["drama"] }],
        genresByContent: new Map([[uid(2), ["drama"]]]),
        semanticScores: new Map([[uid(3), 1]]),
      },
    );
    expect(result.map((value) => value.id)).toEqual([uid(2), uid(3)]);
  });
  it("scopes cache keys to a validated user", () => {
    expect(recommendationCacheKey(uid(2))).toBe(`recommendations:${uid(2)}`);
    expect(() => recommendationCacheKey("bad")).toThrow();
  });
});
