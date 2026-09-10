import { z } from "zod";
import { AIGateway } from "./AIGateway";
import type { AIUsageRepository } from "./AIUsageRepository";
import { AnthropicProvider } from "./AnthropicProvider";
import { ModelRouter, type ModelRoute, type ProviderRegistration } from "./ModelRouter";
import { OpenAIProvider } from "./OpenAIProvider";

const GatewayEnvironmentSchema = z
  .object({
    OPENAI_API_KEY: z.string().min(1),
    OPENAI_BASE_URL: z.string().url().optional(),
    OPENAI_GENERATION_MODEL: z.string().min(1).optional(),
    OPENAI_EMBEDDING_MODEL: z.string().min(1).optional(),
    OPENAI_TRANSCRIPTION_MODEL: z.string().min(1).optional(),
    ANTHROPIC_API_KEY: z.string().min(1).optional(),
    ANTHROPIC_BASE_URL: z.string().url().optional(),
    ANTHROPIC_MODEL: z.string().min(1).optional(),
  })
  .passthrough();

export function createAIGateway(
  environment: Record<string, string | undefined>,
  usage: AIUsageRepository,
): AIGateway {
  const env = GatewayEnvironmentSchema.parse(environment);
  const openAI = new OpenAIProvider({
    apiKey: env.OPENAI_API_KEY,
    baseUrl: env.OPENAI_BASE_URL,
    generationModel: env.OPENAI_GENERATION_MODEL,
    embeddingModel: env.OPENAI_EMBEDDING_MODEL,
    transcriptionModel: env.OPENAI_TRANSCRIPTION_MODEL,
  });
  const providers: ProviderRegistration[] = [{ provider: openAI, costTier: "low" }];
  if (env.ANTHROPIC_API_KEY) {
    providers.push({
      provider: new AnthropicProvider({
        apiKey: env.ANTHROPIC_API_KEY,
        baseUrl: env.ANTHROPIC_BASE_URL,
        model: env.ANTHROPIC_MODEL,
      }),
      costTier: "premium",
    });
  }
  const generationFallback = env.ANTHROPIC_API_KEY ? ["anthropic", "openai"] : ["openai"];
  const routes: ModelRoute[] = [
    { taskType: "cheap_chat", costTier: "low", fallbackChain: ["openai"] },
    {
      taskType: "complex_reasoning",
      costTier: env.ANTHROPIC_API_KEY ? "premium" : "low",
      fallbackChain: generationFallback,
    },
    { taskType: "embedding", costTier: "low", fallbackChain: ["openai"] },
    { taskType: "transcription", costTier: "low", fallbackChain: ["openai"] },
    { taskType: "vision", costTier: "low", fallbackChain: ["openai"] },
  ];
  return new AIGateway(new ModelRouter(providers, routes), usage);
}
