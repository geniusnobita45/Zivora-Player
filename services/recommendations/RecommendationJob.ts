import "server-only";
import { z } from "zod";
import {
  rankRecommendations,
  recommendationCacheKey,
  CatalogItemSchema,
} from "@/features/recommendations";
import type { Json } from "@/lib/supabase/types";

export interface RecommendationJobRepository {
  readCatalog(): Promise<unknown>;
  readHistory(userId: string): Promise<ReadonlyArray<{ contentId: string; genres: string[] }>>;
  readGenres(contentIds: string[]): Promise<ReadonlyMap<string, string[]>>;
  readSemanticScores(userId: string): Promise<ReadonlyMap<string, number>>;
  writeCache(input: {
    userId: string;
    key: string;
    response: Json;
    expiresAt: string;
  }): Promise<void>;
}

/** Runs outside the request path with service-role access; API reads only the resulting cache. */
export async function precomputeRecommendations(
  userIdInput: unknown,
  repository: RecommendationJobRepository,
) {
  const userId = z.string().uuid().parse(userIdInput);
  const items = z.array(CatalogItemSchema).parse(await repository.readCatalog());
  const recommendations = rankRecommendations(items, {
    history: await repository.readHistory(userId),
    genresByContent: await repository.readGenres(items.map((item) => item.id)),
    semanticScores: await repository.readSemanticScores(userId),
  });
  await repository.writeCache({
    userId,
    key: recommendationCacheKey(userId),
    response: recommendations as unknown as Json,
    expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
  });
  return recommendations;
}
