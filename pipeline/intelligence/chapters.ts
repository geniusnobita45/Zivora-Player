import { z } from "zod";
import type { AIProvider } from "@/features/ai/gateway/AIProvider";
import { ChapterSchema, stableUuid, time, type Scene } from "./types";
const OutputSchema = z
  .object({
    chapters: z
      .array(
        z
          .object({
            start: time,
            end: time,
            title: z.string().min(1).max(300),
            summary: z.string().min(1).max(4000),
          })
          .strict(),
      )
      .max(1000),
  })
  .strict();
export async function generateChapters(
  provider: AIProvider,
  mediaVersionId: string,
  scenes: readonly Scene[],
) {
  const value = OutputSchema.parse(
    await provider.generate({
      schema: OutputSchema,
      schemaName: "zivora_chapters_v1",
      system: "Group adjacent scenes into coherent chapters without inventing events.",
      prompt: JSON.stringify(scenes),
    }),
  );
  return z.array(ChapterSchema).parse(
    value.chapters.map((chapter, index) => ({
      ...chapter,
      id: stableUuid(mediaVersionId, "chapter", index),
      index,
    })),
  );
}
