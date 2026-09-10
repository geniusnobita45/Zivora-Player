import { z } from "zod";
import { anthropicMessage, parseJsonText } from "@/lib/ai";
import {
  UnsupportedAICapabilityError,
  type AIProvider,
  type StructuredRequest,
} from "./AIProvider";

const ConfigSchema = z
  .object({
    apiKey: z.string().min(1),
    baseUrl: z.string().url().optional(),
    model: z.string().min(1).default("claude-sonnet-4-5"),
    inputCostPerMillion: z.number().nonnegative().default(3),
    outputCostPerMillion: z.number().nonnegative().default(15),
  })
  .strict();
export type AnthropicProviderConfig = z.input<typeof ConfigSchema>;

export class AnthropicProvider implements AIProvider {
  readonly name = "anthropic";
  readonly capabilities = ["generation"] as const;
  readonly model: string;
  readonly embeddingModel = "unsupported";
  private readonly config: z.output<typeof ConfigSchema>;
  constructor(input: AnthropicProviderConfig) {
    this.config = ConfigSchema.parse(input);
    this.model = this.config.model;
  }
  async generate<T>(request: StructuredRequest<T>): Promise<T> {
    const result = await anthropicMessage(this.config, {
      model: this.model,
      system: request.system,
      prompt: request.prompt,
      signal: request.signal,
    });
    request.onUsage?.({
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      costUsd:
        (result.inputTokens * this.config.inputCostPerMillion +
          result.outputTokens * this.config.outputCostPerMillion) /
        1_000_000,
    });
    return request.schema.parse(parseJsonText(result.text));
  }
  embed(): Promise<unknown> {
    return Promise.reject(new UnsupportedAICapabilityError(this.name, "embedding"));
  }
  transcribe(): Promise<unknown> {
    return Promise.reject(new UnsupportedAICapabilityError(this.name, "transcription"));
  }
  vision<T>(): Promise<T> {
    return Promise.reject(new UnsupportedAICapabilityError(this.name, "vision"));
  }
}
