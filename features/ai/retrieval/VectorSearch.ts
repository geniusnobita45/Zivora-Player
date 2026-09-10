import { EmbeddingSchema } from "./types";
import type { AIProvider } from "../gateway/AIProvider";
export class VectorSearch {
  constructor(private readonly ai: Pick<AIProvider, "embed" | "embeddingModel">) {}
  get model(): string {
    return this.ai.embeddingModel;
  }
  async embed(query: string, signal?: AbortSignal): Promise<number[]> {
    const result = await this.ai.embed({ inputs: [query], dimensions: 1536, signal });
    return EmbeddingSchema.array().length(1).parse(result)[0];
  }
}
