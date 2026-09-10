import { z } from "zod";
import type {
  AIProvider,
  AICapability,
  EmbedRequest,
  StructuredRequest,
  TranscribeRequest,
  VisionInput,
} from "./AIProvider";

export interface MockProviderHandlers {
  generate?: (request: StructuredRequest<unknown>) => unknown | Promise<unknown>;
  embed?: (request: EmbedRequest) => unknown | Promise<unknown>;
  transcribe?: (request: TranscribeRequest) => unknown | Promise<unknown>;
  vision?: (
    request: StructuredRequest<unknown> & { images: readonly VisionInput[] },
  ) => unknown | Promise<unknown>;
}

export class MockProvider implements AIProvider {
  readonly embeddingModel: string;
  readonly capabilities: readonly AICapability[] = [
    "generation",
    "embedding",
    "transcription",
    "vision",
  ];
  constructor(
    readonly name: string,
    readonly model: string,
    private readonly handlers: MockProviderHandlers = {},
  ) {
    this.name = z.string().min(1).parse(name);
    this.model = z.string().min(1).parse(model);
    this.embeddingModel = this.model;
  }
  async generate<T>(request: StructuredRequest<T>): Promise<T> {
    const result = await this.handlers.generate?.(request as StructuredRequest<unknown>);
    request.onUsage?.({ inputTokens: 1, outputTokens: 1, costUsd: 0 });
    return request.schema.parse(result);
  }
  async embed(request: EmbedRequest): Promise<unknown> {
    request.onUsage?.({ inputTokens: request.inputs.length, outputTokens: 0, costUsd: 0 });
    return (
      this.handlers.embed?.(request) ??
      request.inputs.map(() => Array.from({ length: request.dimensions }, () => 0))
    );
  }
  async transcribe(request: TranscribeRequest): Promise<unknown> {
    request.onUsage?.({ inputTokens: 0, outputTokens: 0, costUsd: 0 });
    return (
      this.handlers.transcribe?.(request) ?? {
        language: request.language ?? "und",
        duration: 1,
        segments: [
          {
            start: 0,
            end: 1,
            text: "Mock transcript",
            speaker: null,
            confidence: 1,
          },
        ],
      }
    );
  }
  async vision<T>(request: StructuredRequest<T> & { images: readonly VisionInput[] }): Promise<T> {
    const result = await this.handlers.vision?.(
      request as StructuredRequest<unknown> & { images: readonly VisionInput[] },
    );
    request.onUsage?.({ inputTokens: 1, outputTokens: 1, costUsd: 0 });
    return request.schema.parse(result);
  }
}
