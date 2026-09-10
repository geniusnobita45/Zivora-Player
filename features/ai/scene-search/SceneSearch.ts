import { z } from "zod";
import { AIRequestSchema, AIResponseSchema, type AIRequest } from "../orchestrator/contracts";

export const SceneSearchModeSchema = z.enum(["scene", "mood", "previously_watched"]);
export type SceneSearchMode = z.infer<typeof SceneSearchModeSchema>;

export const SceneSearchRequestSchema = AIRequestSchema.extend({
  question: z.string().trim().min(1).max(2000).optional(),
  query: z.string().trim().min(1).max(500),
  searchMode: SceneSearchModeSchema.default("scene"),
}).strict();
export type SceneSearchRequest = z.infer<typeof SceneSearchRequestSchema>;

export function sceneSearchAIRequest(input: unknown): AIRequest {
  const request = SceneSearchRequestSchema.parse(input);
  const { query, searchMode, ...base } = request;
  const prefix =
    searchMode === "mood"
      ? "Find a scene matching this mood: "
      : searchMode === "previously_watched"
        ? "Find a scene I previously watched: "
        : "Find this scene: ";
  return AIRequestSchema.parse({ ...base, question: `${prefix}${query}` });
}

export const SceneSearchResponseSchema = AIResponseSchema;
