import { z } from "zod";
export const AiAnswerSchema = z.object({
  answer: z.string(),
  confidence: z.number().min(0).max(1),
  citations: z.array(z.string()),
});
export type AiAnswer = z.infer<typeof AiAnswerSchema>;
export interface LegacyAiGateway {
  answer(prompt: string, context: string[]): Promise<AiAnswer>;
}
export * from "./AIProvider";
export * from "./AIGateway";
export * from "./AIUsageRepository";
export * from "./AnthropicProvider";
export * from "./MockProvider";
export * from "./ModelRouter";
export * from "./OpenAIProvider";
export * from "./createAIGateway";
