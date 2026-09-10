import { z } from "zod";
import {
  imageDataUrl,
  openAIEmbeddings,
  openAIResponse,
  openAITranscription,
  parseJsonText,
} from "@/lib/ai";
import type {
  AIProvider,
  AICapability,
  EmbedRequest,
  StructuredRequest,
  TranscribeRequest,
  VisionInput,
} from "./AIProvider";

const ConfigSchema = z
  .object({
    apiKey: z.string().min(1),
    baseUrl: z.string().url().optional(),
    generationModel: z.string().min(1).default("gpt-4.1-mini"),
    embeddingModel: z.string().min(1).default("text-embedding-3-small"),
    transcriptionModel: z.string().min(1).default("gpt-4o-transcribe-diarize"),
    inputCostPerMillion: z.number().nonnegative().default(0.4),
    outputCostPerMillion: z.number().nonnegative().default(1.6),
    embeddingCostPerMillion: z.number().nonnegative().default(0.02),
    transcriptionInputCostPerMillion: z.number().nonnegative().default(2.5),
    transcriptionOutputCostPerMillion: z.number().nonnegative().default(10),
  })
  .strict();
export type OpenAIProviderConfig = z.input<typeof ConfigSchema>;

export class OpenAIProvider implements AIProvider {
  readonly name = "openai";
  readonly capabilities = ["generation", "embedding", "transcription", "vision"] as const;
  readonly model: string;
  readonly embeddingModel: string;
  private readonly config: z.output<typeof ConfigSchema>;
  constructor(input: OpenAIProviderConfig) {
    this.config = ConfigSchema.parse(input);
    this.model = this.config.generationModel;
    this.embeddingModel = this.config.embeddingModel;
  }
  modelFor(capability: AICapability): string {
    return capability === "embedding"
      ? this.embeddingModel
      : capability === "transcription"
        ? this.config.transcriptionModel
        : this.model;
  }
  async generate<T>(request: StructuredRequest<T>): Promise<T> {
    const result = await openAIResponse(this.config, {
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
  async embed(request: EmbedRequest): Promise<unknown> {
    const result = await openAIEmbeddings(this.config, {
      model: this.embeddingModel,
      values: request.inputs,
      dimensions: request.dimensions,
      signal: request.signal,
    });
    request.onUsage?.({
      inputTokens: result.inputTokens,
      outputTokens: 0,
      costUsd: (result.inputTokens * this.config.embeddingCostPerMillion) / 1_000_000,
    });
    return result.embeddings;
  }
  async transcribe(request: TranscribeRequest): Promise<unknown> {
    const result = await openAITranscription(this.config, {
      model: this.config.transcriptionModel,
      mediaPath: request.mediaPath,
      language: request.language,
      signal: request.signal,
    });
    const duration = result.duration ?? result.segments.at(-1)?.end ?? 0;
    const usage = z
      .object({
        input_tokens: z.number().int().nonnegative(),
        output_tokens: z.number().int().nonnegative(),
      })
      .safeParse(result.usage);
    const inputTokens = usage.success ? usage.data.input_tokens : 0;
    const outputTokens = usage.success ? usage.data.output_tokens : 0;
    request.onUsage?.({
      inputTokens,
      outputTokens,
      costUsd:
        (inputTokens * this.config.transcriptionInputCostPerMillion +
          outputTokens * this.config.transcriptionOutputCostPerMillion) /
        1_000_000,
    });
    return {
      language: result.language ?? request.language ?? "und",
      duration,
      segments: result.segments.map((segment) => ({
        start: segment.start,
        end: segment.end,
        text: segment.text,
        speaker: segment.speaker ?? null,
        confidence: segment.confidence ?? null,
      })),
    };
  }
  async vision<T>(request: StructuredRequest<T> & { images: readonly VisionInput[] }): Promise<T> {
    const images = await Promise.all(request.images.map((image) => imageDataUrl(image.imagePath)));
    const result = await openAIResponse(this.config, {
      model: this.model,
      system: request.system,
      prompt: request.prompt,
      images,
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
}
