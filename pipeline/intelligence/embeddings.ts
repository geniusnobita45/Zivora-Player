import { z } from "zod";
import type { AIProvider } from "@/features/ai/gateway/AIProvider";
import { EmbeddingBatchSchema, stableUuid, type Scene, type Transcription } from "./types";

export async function generateEmbeddings(
  provider: AIProvider,
  mediaVersionId: string,
  scenes: readonly Scene[],
  transcript: Transcription,
  batchSize = 64,
) {
  const size = z.number().int().min(1).max(512).parse(batchSize);
  const items = [
    ...scenes.map((scene) => ({
      source: "scene" as const,
      sourceId: scene.id,
      text: `${scene.title}\n${scene.summary}`,
    })),
    ...transcript.segments.map((segment, index) => ({
      source: "transcript" as const,
      sourceId: stableUuid(mediaVersionId, "transcript", index, segment.start, segment.end),
      text: segment.text,
    })),
  ];
  const output: {
    id: string;
    source: "scene" | "transcript";
    sourceId: string;
    model: string;
    embedding: number[];
  }[] = [];
  for (let offset = 0; offset < items.length; offset += size) {
    const batch = items.slice(offset, offset + size);
    const vectors = EmbeddingBatchSchema.length(batch.length).parse(
      await provider.embed({ inputs: batch.map((item) => item.text), dimensions: 1536 }),
    );
    batch.forEach((item, index) =>
      output.push({
        id: stableUuid(mediaVersionId, "embedding", item.source, item.sourceId),
        ...item,
        model: provider.embeddingModel,
        embedding: vectors[index],
      }),
    );
  }
  return output;
}
