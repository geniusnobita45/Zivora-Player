import { z } from "zod";
import { AIRequestSchema, AIResponseSchema, type AIRequest } from "../orchestrator/contracts";

export const DialogueActionSchema = z.enum(["what_was_said", "meaning", "reference"]);
export type DialogueAction = z.infer<typeof DialogueActionSchema>;
export const DialogueAssistantRequestSchema = AIRequestSchema.extend({
  action: DialogueActionSchema.default("what_was_said"),
  question: z.string().trim().min(1).max(500).optional(),
}).strict();
export type DialogueAssistantRequest = z.infer<typeof DialogueAssistantRequestSchema>;

export function dialogueAIRequest(input: unknown): AIRequest {
  const request = DialogueAssistantRequestSchema.parse(input);
  const { action, ...base } = request;
  const defaults: Record<DialogueAction, string> = {
    what_was_said: "What was just said in the current scene?",
    meaning: "What does the dialogue just heard mean?",
    reference: "Explain the cultural reference just heard.",
  };
  return AIRequestSchema.parse({ ...base, question: defaults[action] });
}

export const DialogueAssistantResponseSchema = AIResponseSchema;
