import { z } from "zod";
import type { AIProvider } from "@/features/ai/gateway/AIProvider";
import { RecapSchema, stableUuid, time, type Scene, type Transcription } from "./types";
const OutputSchema = z
  .object({
    segments: z
      .array(
        z
          .object({
            kind: z.enum(["episode", "what_did_i_miss"]),
            start: time,
            end: time,
            summary: z.string().min(1).max(10000),
          })
          .strict(),
      )
      .min(2)
      .max(1000),
  })
  .strict()
  .superRefine(({ segments }, context) => {
    for (const requiredKind of ["episode", "what_did_i_miss"] as const) {
      if (!segments.some(({ kind }) => kind === requiredKind)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Missing required ${requiredKind} recap`,
          path: ["segments"],
        });
      }
    }
  });
export async function generateRecaps(
  provider: AIProvider,
  mediaVersionId: string,
  scenes: readonly Scene[],
  transcript: Transcription,
) {
  const value = OutputSchema.parse(
    await provider.generate({
      schema: OutputSchema,
      schemaName: "zivora_recaps_v1",
      system:
        "Produce one episode recap and timestamp-bounded what-did-I-miss summaries using only supplied evidence.",
      prompt: JSON.stringify({ scenes, transcript: transcript.segments }),
    }),
  );
  return z.array(RecapSchema).parse(
    value.segments.map((segment, index) => ({
      ...segment,
      id: stableUuid(mediaVersionId, "recap", segment.kind, index),
    })),
  );
}
