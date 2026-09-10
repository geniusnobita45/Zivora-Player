import type { ZodType } from "zod";

export interface ProviderUsage {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export type UsageSink = (usage: ProviderUsage) => void;
export type AICapability = "generation" | "embedding" | "transcription" | "vision";

export interface StructuredRequest<T> {
  system: string;
  prompt: string;
  schema: ZodType<T>;
  schemaName: string;
  signal?: AbortSignal;
  onUsage?: UsageSink;
}
export interface EmbedRequest {
  inputs: readonly string[];
  dimensions: 1536;
  signal?: AbortSignal;
  onUsage?: UsageSink;
}
export interface TranscribeRequest {
  mediaPath: string;
  language?: string;
  diarize: boolean;
  signal?: AbortSignal;
  onUsage?: UsageSink;
}
export interface VisionInput {
  imagePath: string;
  timestampSeconds?: number;
}

/**
 * Provider SDKs and provider-specific response shapes terminate at implementations
 * of this interface.
 */
export interface AIProvider {
  readonly name: string;
  readonly model: string;
  readonly embeddingModel: string;
  readonly capabilities?: readonly AICapability[];
  modelFor?(capability: AICapability): string;
  generate<T>(request: StructuredRequest<T>): Promise<T>;
  embed(request: EmbedRequest): Promise<unknown>;
  transcribe(request: TranscribeRequest): Promise<unknown>;
  vision<T>(request: StructuredRequest<T> & { images: readonly VisionInput[] }): Promise<T>;
}

export class UnsupportedAICapabilityError extends Error {
  constructor(provider: string, capability: string) {
    super(`${provider} does not support ${capability}`);
    this.name = "UnsupportedAICapabilityError";
  }
}
