import { z } from "zod";
import { AIRequestSchema, AIResponseSchema, type AIRequest } from "../orchestrator/contracts";

export const CharacterAssistantRequestSchema = AIRequestSchema.extend({
  characterId: z.string().uuid().optional(),
  characterName: z.string().trim().min(1).max(160),
  question: z.string().trim().min(1).max(500).default("Who is this character?"),
}).strict();
export type CharacterAssistantRequest = z.infer<typeof CharacterAssistantRequestSchema>;

/** Builds a character-scoped request; SQL still applies the watch boundary before generation. */
export function characterAIRequest(input: unknown): AIRequest {
  const request = CharacterAssistantRequestSchema.parse(input);
  const { characterId, characterName, ...base } = request;
  return AIRequestSchema.parse({
    ...base,
    question: `${base.question} Character: ${characterName}. Use only appearances already watched.`,
    filters: characterId ? { ...base.filters, character_id: characterId } : base.filters,
  });
}

export const CharacterAssistantResponseSchema = AIResponseSchema;
