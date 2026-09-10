import { z } from "zod";
import { AIRequestSchema, AIResponseSchema, type AIRequest } from "../orchestrator/contracts";

export const RecapKindSchema = z.enum(["what_did_i_miss", "previous_episode", "season"]);
export type RecapKind = z.infer<typeof RecapKindSchema>;
export const RecapRequestSchema = AIRequestSchema.extend({
  question: z.string().trim().min(1).max(2000).optional(),
  kind: RecapKindSchema.default("what_did_i_miss"),
  fromPosition: z.number().finite().min(0).max(86400).optional(),
}).strict();
export type RecapRequest = z.infer<typeof RecapRequestSchema>;

export const RecapSegmentSchema = z
  .object({
    id: z.string().uuid(),
    episodeId: z.string().uuid().nullable(),
    episodeOrder: z.number().int().min(0),
    start: z.number().finite().min(0),
    end: z.number().finite().positive(),
    summary: z.string().trim().min(1).max(4000),
  })
  .strict()
  .refine((value) => value.end > value.start, "Recap segment end must follow start");
export type RecapSegment = z.infer<typeof RecapSegmentSchema>;

/** Deterministic, offline-generated recap text is deliberately preferred over a model summary. */
export function recapFromSegments(input: unknown): string {
  const segments = z.array(RecapSegmentSchema).max(40).parse(input);
  if (!segments.length) return "There is nothing new in your watched progress to recap.";
  return segments.map((segment) => segment.summary).join(" ");
}

export function recapAIRequest(input: unknown): AIRequest {
  const request = RecapRequestSchema.parse(input);
  const { kind, fromPosition, ...base } = request;
  const prompts: Record<RecapKind, string> = {
    what_did_i_miss:
      fromPosition === undefined
        ? "What did I miss since my last stable position? Use recap segments only."
        : `What did I miss from ${fromPosition} seconds to my current position? Use recap segments only.`,
    previous_episode: "Give a spoiler-safe recap of the previous episode.",
    season: "Give a spoiler-safe recap of the season so far.",
  };
  return AIRequestSchema.parse({ ...base, question: prompts[kind] });
}

export const RecapResponseSchema = AIResponseSchema;
