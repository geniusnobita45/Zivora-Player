import { z } from "zod";
import { PlayerCommandSchema, LanguageSchema } from "@/core/player/PlayerCommand";
import {
  SpoilerModeSchema,
  WatchStateSchema,
  WatchBoundarySchema,
} from "../spoiler-guard/WatchBoundary";
export const IntentSchema = z.enum([
  "find_scene",
  "who_is_character",
  "what_happened",
  "recap",
  "explain_reference",
  "control_player",
  "mood_search",
  "previously_watched",
  "general",
]);
export type AIIntent = z.infer<typeof IntentSchema>;
export const AIRequestSchema = z
  .object({
    question: z.string().trim().min(1).max(2000),
    contentId: z.string().uuid(),
    episodeId: z.string().uuid().nullable().default(null),
    conversationId: z.string().uuid().nullable().default(null),
    watchState: WatchStateSchema,
    mode: SpoilerModeSchema.default("strict_current"),
    language: LanguageSchema.default("en"),
    filters: z
      .object({
        character_id: z.string().uuid().optional(),
        chapter_id: z.string().uuid().optional(),
      })
      .strict()
      .default({}),
  })
  .strict();
export type AIRequest = z.infer<typeof AIRequestSchema>;
export const CandidateSchema = z
  .object({
    timestamp: z.number().finite().min(0).max(86400),
    label: z.string().trim().min(1).max(500),
    confidence: z.number().finite().min(0).max(1),
    evidenceId: z.string().uuid().optional(),
    episodeId: z.string().uuid().nullable().optional(),
  })
  .strict();
export const AIAnswerSchema = z
  .object({
    answer: z.string().trim().min(1).max(10000),
    confidence: z.number().finite().min(0).max(1),
    candidates: z.array(CandidateSchema).max(10),
    command: PlayerCommandSchema.optional(),
  })
  .strict();
export type AIAnswer = z.infer<typeof AIAnswerSchema>;
export const AIResponseSchema = AIAnswerSchema.extend({
  conversationId: z.string().uuid().nullable(),
  intent: IntentSchema,
  boundary: WatchBoundarySchema,
}).strict();
export const AuthorizedContextSchema = z
  .object({
    userId: z.string().uuid(),
    duration: z.number().finite().positive().max(86400),
    mediaVersionIds: z.array(z.string().uuid()).min(1).max(10000),
    modelVersion: z.string().min(1).max(500),
  })
  .strict();
export type AuthorizedContext = z.infer<typeof AuthorizedContextSchema>;
