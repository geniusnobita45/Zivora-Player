import { randomUUID } from "node:crypto";
import { z } from "zod";
import type {
  AICapability,
  AIProvider,
  EmbedRequest,
  ProviderUsage,
  StructuredRequest,
  TranscribeRequest,
  VisionInput,
} from "./AIProvider";
import type { AIUsageRepository } from "./AIUsageRepository";
import {
  AITaskTypeSchema,
  CostTierSchema,
  type AITaskType,
  type CostTier,
  type ModelRouter,
} from "./ModelRouter";

const RequestOptionsSchema = z
  .object({
    userId: z.string().uuid().nullable().default(null),
    conversationId: z.string().uuid().nullable().default(null),
    timeoutMs: z.number().int().min(100).max(120000).default(30000),
    retries: z.number().int().min(0).max(3).default(1),
    maximumCostTier: CostTierSchema.default("premium"),
  })
  .strict();
export type GatewayRequestOptions = z.input<typeof RequestOptionsSchema>;

export class AIGatewayError extends Error {
  constructor(
    message: string,
    readonly code: "TIMEOUT" | "ALL_PROVIDERS_FAILED" | "ABORTED",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "AIGatewayError";
  }
}

interface GenerateInput<T> extends Omit<StructuredRequest<T>, "signal" | "onUsage"> {
  taskType?: "cheap_chat" | "complex_reasoning";
  options?: GatewayRequestOptions;
  signal?: AbortSignal;
}
interface VisionRequest<T> extends Omit<StructuredRequest<T>, "signal" | "onUsage"> {
  images: readonly VisionInput[];
  options?: GatewayRequestOptions;
  signal?: AbortSignal;
}
interface EmbedInput extends Omit<EmbedRequest, "signal" | "onUsage"> {
  options?: GatewayRequestOptions;
  signal?: AbortSignal;
}
interface TranscriptionInput extends Omit<TranscribeRequest, "signal" | "onUsage"> {
  options?: GatewayRequestOptions;
  signal?: AbortSignal;
}

function mergedSignal(parent: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new AIGatewayError("AI provider timed out", "TIMEOUT")),
    timeoutMs,
  );
  const abort = () =>
    controller.abort(parent?.reason ?? new AIGatewayError("AI request aborted", "ABORTED"));
  parent?.addEventListener("abort", abort, { once: true });
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeout);
      parent?.removeEventListener("abort", abort);
    },
  };
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

export class AIGateway implements AIProvider {
  readonly name = "gateway";
  readonly model = "routed";
  get embeddingModel(): string {
    const provider = this.router.route("embedding")[0].provider;
    return provider.modelFor?.("embedding") ?? provider.embeddingModel;
  }
  readonly capabilities = ["generation", "embedding", "transcription", "vision"] as const;
  constructor(
    private readonly router: ModelRouter,
    private readonly usage: AIUsageRepository,
    private readonly now: () => number = Date.now,
  ) {}

  generate<T>(request: GenerateInput<T>): Promise<T> {
    const task = z
      .enum(["cheap_chat", "complex_reasoning"])
      .default("complex_reasoning")
      .parse(request.taskType);
    if (!request.schema || typeof request.schema.parse !== "function")
      return Promise.reject(new TypeError("A Zod output schema is required"));
    return this.execute(
      task,
      "generation",
      request.options,
      request.signal,
      (provider, signal, onUsage) => provider.generate({ ...request, signal, onUsage }),
    );
  }

  embed(request: EmbedInput): Promise<unknown> {
    const value = z
      .object({
        inputs: z.array(z.string().min(1)).min(1).max(512),
        dimensions: z.literal(1536),
      })
      .strict()
      .parse({ inputs: request.inputs, dimensions: request.dimensions });
    return this.execute(
      "embedding",
      "embedding",
      request.options,
      request.signal,
      (provider, signal, onUsage) => provider.embed({ ...value, signal, onUsage }),
    );
  }

  transcribe(request: TranscriptionInput): Promise<unknown> {
    const value = z
      .object({
        mediaPath: z.string().min(1),
        language: z.string().min(1).optional(),
        diarize: z.boolean(),
      })
      .strict()
      .parse({
        mediaPath: request.mediaPath,
        language: request.language,
        diarize: request.diarize,
      });
    return this.execute(
      "transcription",
      "transcription",
      request.options,
      request.signal,
      (provider, signal, onUsage) => provider.transcribe({ ...value, signal, onUsage }),
    );
  }

  vision<T>(request: VisionRequest<T>): Promise<T> {
    if (!request.schema || typeof request.schema.parse !== "function")
      return Promise.reject(new TypeError("A Zod output schema is required"));
    const images = z
      .array(
        z
          .object({
            imagePath: z.string().min(1),
            timestampSeconds: z.number().nonnegative().optional(),
          })
          .strict(),
      )
      .min(1)
      .max(32)
      .parse(request.images);
    return this.execute(
      "vision",
      "vision",
      request.options,
      request.signal,
      (provider, signal, onUsage) => provider.vision({ ...request, images, signal, onUsage }),
    );
  }

  private async execute<T>(
    task: AITaskType,
    capability: AICapability,
    inputOptions: GatewayRequestOptions | undefined,
    parentSignal: AbortSignal | undefined,
    invoke: (
      provider: ReturnType<ModelRouter["route"]>[number]["provider"],
      signal: AbortSignal,
      onUsage: (usage: ProviderUsage) => void,
    ) => Promise<T>,
  ): Promise<T> {
    AITaskTypeSchema.parse(task);
    const options = RequestOptionsSchema.parse(inputOptions ?? {});
    const requestId = randomUUID();
    const started = this.now();
    let attempts = 0;
    let providerName = "none";
    let model = "none";
    let tier: CostTier = "low";
    let inputTokens = 0;
    let outputTokens = 0;
    let costUsd = 0;
    let lastError: unknown;
    let succeeded = false;
    try {
      for (const candidate of this.router.route(task, options.maximumCostTier)) {
        providerName = candidate.provider.name;
        model =
          candidate.provider.modelFor?.(capability) ??
          (capability === "embedding"
            ? candidate.provider.embeddingModel
            : candidate.provider.model);
        tier = candidate.costTier;
        for (let retry = 0; retry <= options.retries; retry++) {
          attempts++;
          if (parentSignal?.aborted) {
            lastError = new AIGatewayError("AI request aborted", "ABORTED", {
              cause: parentSignal.reason,
            });
            throw lastError;
          }
          const attempt = mergedSignal(parentSignal, options.timeoutMs);
          try {
            const result = await abortable(
              invoke(candidate.provider, attempt.signal, (usage) => {
                const value = z
                  .object({
                    inputTokens: z.number().int().nonnegative(),
                    outputTokens: z.number().int().nonnegative(),
                    costUsd: z.number().finite().nonnegative(),
                  })
                  .strict()
                  .parse(usage);
                inputTokens += value.inputTokens;
                outputTokens += value.outputTokens;
                costUsd += value.costUsd;
              }),
              attempt.signal,
            );
            succeeded = true;
            return result;
          } catch (error) {
            lastError = attempt.signal.aborted ? attempt.signal.reason : error;
            if (parentSignal?.aborted) {
              lastError = new AIGatewayError("AI request aborted", "ABORTED", {
                cause: parentSignal.reason,
              });
              throw lastError;
            }
          } finally {
            attempt.cleanup();
          }
        }
      }
      lastError = new AIGatewayError("All AI providers failed", "ALL_PROVIDERS_FAILED", {
        cause: lastError,
      });
      throw lastError;
    } finally {
      const success = succeeded;
      const accounting = mergedSignal(parentSignal, 500);
      try {
        await abortable(
          Promise.resolve().then(() =>
            this.usage.record({
              request_id: requestId,
              user_id: options.userId,
              conversation_id: options.conversationId,
              task_type: task,
              provider: providerName,
              model,
              cost_tier: tier,
              attempts: Math.max(1, attempts),
              input_tokens: inputTokens,
              output_tokens: outputTokens,
              cost_usd: costUsd,
              duration_ms: Math.max(0, Math.round(this.now() - started)),
              success,
              error_code: success
                ? null
                : lastError instanceof AIGatewayError
                  ? lastError.code
                  : "PROVIDER_ERROR",
            }),
          ),
          accounting.signal,
        ).catch(() => undefined);
      } finally {
        accounting.cleanup();
      }
    }
  }
}
