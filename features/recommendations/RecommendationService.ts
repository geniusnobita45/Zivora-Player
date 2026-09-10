import { z } from "zod";

export const CatalogItemSchema = z
  .object({
    id: z.string().uuid(),
    type: z.enum(["movie", "series", "anime", "concert", "long_video"]),
    title: z.string().min(1).max(1000),
    synopsis: z.string().nullable(),
    release_date: z.string().nullable(),
    runtime_seconds: z.number().int().positive().nullable(),
    active_media_version_id: z.string().uuid(),
    created_at: z.string().nullable(),
    updated_at: z.string().nullable(),
  })
  .strict();
export type CatalogItem = z.infer<typeof CatalogItemSchema>;

export const RecommendationSchema = CatalogItemSchema.extend({
  score: z.number().finite(),
  reason: z.enum(["genre", "history", "semantic", "fresh"]),
}).strict();
export type Recommendation = z.infer<typeof RecommendationSchema>;

export interface RecommendationSignals {
  history: ReadonlyArray<{ contentId: string; genres: ReadonlyArray<string> }>;
  genresByContent: ReadonlyMap<string, ReadonlyArray<string>>;
  semanticScores?: ReadonlyMap<string, number>;
}

/** Deterministic ranking used by the service-role precompute job and its safe fallback. */
export function rankRecommendations(itemsInput: unknown, signals: RecommendationSignals) {
  const items = z.array(CatalogItemSchema).parse(itemsInput);
  const watched = new Set(signals.history.map((entry) => entry.contentId));
  const preferredGenres = new Set(signals.history.flatMap((entry) => entry.genres));
  return items
    .filter((item) => !watched.has(item.id))
    .map((item) => {
      const genres = signals.genresByContent.get(item.id) ?? [];
      const genreScore = genres.filter((genre) => preferredGenres.has(genre)).length;
      const semanticScore = Math.max(0, Math.min(1, signals.semanticScores?.get(item.id) ?? 0));
      const freshScore = item.release_date ? Math.max(0, Date.parse(item.release_date)) / 1e13 : 0;
      const score = genreScore * 3 + semanticScore * 2 + freshScore;
      return {
        ...item,
        score,
        reason: semanticScore >= genreScore ? "semantic" : genreScore ? "genre" : "fresh",
      } satisfies Recommendation;
    })
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
    .slice(0, 40);
}

export function recommendationCacheKey(userId: string) {
  return `recommendations:${z.string().uuid().parse(userId)}`;
}
