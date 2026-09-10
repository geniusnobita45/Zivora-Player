import { z } from "zod";
import type { AICapability, AIProvider } from "./AIProvider";

export const AITaskTypeSchema = z.enum([
  "cheap_chat",
  "complex_reasoning",
  "embedding",
  "transcription",
  "vision",
]);
export type AITaskType = z.infer<typeof AITaskTypeSchema>;
export const CostTierSchema = z.enum(["low", "standard", "premium"]);
export type CostTier = z.infer<typeof CostTierSchema>;

const ProviderRegistrationSchema = z
  .object({ name: z.string().min(1), costTier: CostTierSchema })
  .strict();
export interface ProviderRegistration {
  provider: AIProvider;
  costTier: CostTier;
}
export interface ModelRoute {
  taskType: AITaskType;
  costTier: CostTier;
  fallbackChain: readonly string[];
}
export type RoutedProvider = ProviderRegistration;

const capabilityFor = (task: AITaskType): AICapability =>
  task === "embedding"
    ? "embedding"
    : task === "transcription"
      ? "transcription"
      : task === "vision"
        ? "vision"
        : "generation";

export class ModelRouter {
  private readonly providers = new Map<string, ProviderRegistration>();
  private readonly routes = new Map<AITaskType, ModelRoute>();

  constructor(providers: readonly ProviderRegistration[], routes: readonly ModelRoute[]) {
    for (const registration of providers) {
      const parsed = ProviderRegistrationSchema.parse({
        name: registration.provider.name,
        costTier: registration.costTier,
      });
      if (this.providers.has(parsed.name)) throw new Error(`Duplicate AI provider: ${parsed.name}`);
      this.providers.set(parsed.name, registration);
    }
    for (const route of routes) {
      const parsed = z
        .object({
          taskType: AITaskTypeSchema,
          costTier: CostTierSchema,
          fallbackChain: z.array(z.string().min(1)).min(1).max(10),
        })
        .strict()
        .parse(route);
      if (this.routes.has(parsed.taskType))
        throw new Error(`Duplicate AI route: ${parsed.taskType}`);
      if (new Set(parsed.fallbackChain).size !== parsed.fallbackChain.length)
        throw new Error(`Duplicate provider in ${parsed.taskType} fallback chain`);
      this.routes.set(parsed.taskType, parsed);
    }
  }

  route(taskInput: unknown, maximumTier: CostTier = "premium"): RoutedProvider[] {
    const task = AITaskTypeSchema.parse(taskInput);
    const tier = CostTierSchema.parse(maximumTier);
    const route = this.routes.get(task);
    if (!route) throw new Error(`No route configured for ${task}`);
    const rank: Record<CostTier, number> = { low: 0, standard: 1, premium: 2 };
    if (rank[route.costTier] > rank[tier])
      throw new Error(`Route ${task} exceeds cost tier ${tier}`);
    const capability = capabilityFor(task);
    const candidates = route.fallbackChain.flatMap((name) => {
      const registration = this.providers.get(name);
      if (!registration) throw new Error(`Unknown provider in ${task} route: ${name}`);
      if (rank[registration.costTier] > rank[tier]) return [];
      if (
        registration.provider.capabilities &&
        !registration.provider.capabilities.includes(capability)
      )
        return [];
      return [registration];
    });
    if (!candidates.length)
      throw new Error(`No ${task} provider is available within cost tier ${tier}`);
    return candidates;
  }
}

export function defaultModelRoutes(openAI = "openai", anthropic = "anthropic"): ModelRoute[] {
  return [
    { taskType: "cheap_chat", costTier: "low", fallbackChain: [openAI, anthropic] },
    { taskType: "complex_reasoning", costTier: "premium", fallbackChain: [anthropic, openAI] },
    { taskType: "embedding", costTier: "low", fallbackChain: [openAI] },
    { taskType: "transcription", costTier: "standard", fallbackChain: [openAI] },
    { taskType: "vision", costTier: "standard", fallbackChain: [openAI] },
  ];
}
