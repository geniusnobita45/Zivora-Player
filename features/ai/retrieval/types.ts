import { z } from "zod";
import { WatchBoundarySchema } from "../spoiler-guard/WatchBoundary";
import { RetrievalFiltersSchema } from "../spoiler-guard/RetrievalPolicy";
export const SearchResultSchema = z
  .object({
    id: z.string().uuid(),
    kind: z.enum(["scene", "transcript"]),
    content_id: z.string().uuid(),
    episode_id: z.string().uuid().nullable(),
    media_version_id: z.string().uuid(),
    episode_order: z.number().int().nonnegative(),
    start_s: z.number().finite().min(0).max(86400),
    end_s: z.number().finite().min(0).max(86400),
    title: z.string().max(2000),
    text: z.string().max(50000),
    character_ids: z.array(z.string().uuid()).max(1000),
    chapter_id: z.string().uuid().nullable(),
    chapter_title: z.string().max(2000).nullable(),
    fused_score: z.number().finite().nonnegative(),
    vector_score: z.number().finite().min(-1).max(1).nullable(),
    keyword_score: z.number().finite().nonnegative(),
  })
  .strict()
  .refine((v) => v.end_s > v.start_s);
export type SearchResult = z.infer<typeof SearchResultSchema>;
export const EmbeddingSchema = z
  .array(z.number().finite())
  .length(1536)
  .refine((v) => v.some((n) => n !== 0), "Cosine search needs a nonzero vector");
export const SearchRequestSchema = z
  .object({
    contentId: z.string().uuid(),
    query: z.string().trim().min(1).max(2000),
    boundary: WatchBoundarySchema,
    filters: RetrievalFiltersSchema.default({}),
    limit: z.number().int().min(1).max(30).default(10),
  })
  .strict();
export type SearchRequest = z.input<typeof SearchRequestSchema>;
export interface SearchRPC {
  (
    name: "search_scenes" | "search_transcript",
    args: {
      query_embedding: string | null;
      query_text: string;
      content_id: string;
      boundary_episode_order: number;
      boundary_seconds: number;
      filters: Record<string, unknown>;
      limit: number;
    },
    signal?: AbortSignal,
  ): Promise<unknown>;
}
