import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { AIProvider } from "@/features/ai/gateway/AIProvider";
import { stableUuid, TranscriptionSchema } from "./types";

export const TranscriptionStageSchema = TranscriptionSchema;
export async function transcribeMedia(
  provider: AIProvider,
  mediaVersionId: string,
  mediaPath: string,
  language?: string,
) {
  const path = z.string().min(1).parse(mediaPath);
  const result = TranscriptionStageSchema.parse(
    await provider.transcribe({ mediaPath: path, language, diarize: true }),
  );
  const checksum = createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
  return {
    ...result,
    segments: result.segments.map((segment, index) => ({
      ...segment,
      id: stableUuid(mediaVersionId, "transcript", index, segment.start, segment.end),
      index,
    })),
    provider: provider.name,
    model: provider.model,
    sourceChecksum: checksum,
  };
}
