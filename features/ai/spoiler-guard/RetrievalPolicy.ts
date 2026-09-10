import { z } from "zod";
export const RetrievalFiltersSchema = z
  .object({
    episode_id: z.string().uuid().optional(),
    character_id: z.string().uuid().optional(),
    chapter_id: z.string().uuid().optional(),
    language: z.string().trim().min(2).max(64).optional(),
    embedding_model: z.string().min(1).max(128).optional(),
    media_version_ids: z.array(z.string().uuid()).min(1).max(10000).optional(),
  })
  .strict();
export const RetrievalPolicy = Object.freeze({
  version: "spoiler-v1-end-inclusive",
  rrfK: 60,
  maxResults: 30,
  contextCharacters: 16000,
  automaticSeekConfidence: 0.8,
});
export type RetrievalFilters = z.infer<typeof RetrievalFiltersSchema>;
