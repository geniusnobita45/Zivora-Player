import "server-only";
import { z } from "zod";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import { CatalogItemSchema } from "@/features/recommendations";
import { precomputeRecommendations } from "./RecommendationJob";

/** Service-role adapter for the scheduled recommendation materialization job. */
export async function precomputeUserRecommendations(userId: string) {
  const db = createServiceSupabaseClient();
  return precomputeRecommendations(userId, {
    async readCatalog() {
      const result = await db.from("public_catalog").select("*").limit(2000);
      if (result.error) throw result.error;
      return z.array(CatalogItemSchema).parse(result.data);
    },
    async readHistory(id) {
      const result = await db
        .from("watch_history")
        .select("content_id")
        .eq("user_id", id)
        .eq("completed", true)
        .limit(1000);
      if (result.error) throw result.error;
      const ids = result.data.map((row) => row.content_id);
      if (!ids.length) return [];
      const links = await db
        .from("content_genres")
        .select("content_id,genre_id")
        .in("content_id", ids);
      if (links.error) throw links.error;
      const names = await db
        .from("genres")
        .select("id,slug")
        .in("id", [...new Set(links.data.map((row) => row.genre_id))]);
      if (names.error) throw names.error;
      return ids.map((contentId) => ({
        contentId,
        genres: links.data
          .filter((row) => row.content_id === contentId)
          .flatMap((row) =>
            names.data.filter((genre) => genre.id === row.genre_id).map((genre) => genre.slug),
          ),
      }));
    },
    async readGenres(ids) {
      if (!ids.length) return new Map();
      const result = await db
        .from("content_genres")
        .select("content_id,genre_id")
        .in("content_id", ids)
        .limit(10000);
      if (result.error) throw result.error;
      const names = await db
        .from("genres")
        .select("id,slug")
        .in("id", [...new Set(result.data.map((row) => row.genre_id))]);
      if (names.error) throw names.error;
      return new Map(
        ids.map((id) => [
          id,
          result.data
            .filter((row) => row.content_id === id)
            .flatMap((row) =>
              names.data.filter((genre) => genre.id === row.genre_id).map((genre) => genre.slug),
            ),
        ]),
      );
    },
    async readSemanticScores() {
      // Embedding similarity is injected by the offline intelligence job when available.
      return new Map();
    },
    async writeCache(input) {
      const result = await db.from("ai_cache").upsert(
        {
          user_id: input.userId,
          cache_key: input.key,
          task_type: "cheap_chat",
          provider: "recommendations",
          model: "recommendation-v1",
          response: input.response,
          expires_at: input.expiresAt,
        },
        { onConflict: "cache_key" },
      );
      if (result.error) throw result.error;
    },
  });
}
