import { createHash } from "node:crypto";
import { z } from "zod";

export const time = z.number().finite().min(0).max(86400);
export const TimedTextSchema = z
  .object({
    start: time,
    end: time,
    text: z.string().trim().min(1).max(10000),
    speaker: z.string().trim().min(1).max(200).nullable(),
    confidence: z.number().min(0).max(1).nullable(),
  })
  .strict()
  .refine((v) => v.end > v.start);
export const TranscriptionSchema = z
  .object({
    language: z.string().min(1).max(35),
    duration: time.positive(),
    segments: z.array(TimedTextSchema).max(200000),
  })
  .strict();
export type Transcription = z.infer<typeof TranscriptionSchema>;
export const SceneSchema = z
  .object({
    id: z.string().uuid(),
    index: z.number().int().nonnegative(),
    start: time,
    end: time,
    title: z.string().trim().min(1).max(300),
    summary: z.string().trim().min(1).max(4000),
    visualConfidence: z.number().min(0).max(1).nullable(),
  })
  .strict()
  .refine((v) => v.end > v.start);
export type Scene = z.infer<typeof SceneSchema>;
export const CharacterSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().trim().min(1).max(300),
    description: z.string().max(4000),
    aliases: z.array(z.string().min(1).max(300)).max(30),
    firstAppearance: time.nullable(),
    sceneIds: z.array(z.string().uuid()).max(100000),
  })
  .strict();
export type Character = z.infer<typeof CharacterSchema>;
export const ChapterSchema = z
  .object({
    id: z.string().uuid(),
    index: z.number().int().nonnegative(),
    start: time,
    end: time,
    title: z.string().trim().min(1).max(300),
    summary: z.string().trim().min(1).max(4000),
  })
  .strict()
  .refine((v) => v.end > v.start);
export type Chapter = z.infer<typeof ChapterSchema>;
export const RecapSchema = z
  .object({
    id: z.string().uuid(),
    kind: z.enum(["episode", "what_did_i_miss"]),
    start: time,
    end: time,
    summary: z.string().trim().min(1).max(10000),
  })
  .strict()
  .refine((v) => v.end > v.start);
export type Recap = z.infer<typeof RecapSchema>;
export const SkipSegmentSchema = z
  .object({
    id: z.string().uuid(),
    kind: z.enum(["intro", "recap", "credits"]),
    start: time,
    end: time,
    confidence: z.number().min(0).max(1),
    evidence: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])),
  })
  .strict()
  .refine((v) => v.end > v.start);
export type SkipSegment = z.infer<typeof SkipSegmentSchema>;
export const EmbeddingSchema = z.array(z.number().finite()).length(1536);
export const EmbeddingBatchSchema = z.array(EmbeddingSchema).max(512);

export function stableUuid(...parts: readonly (string | number)[]): string {
  const bytes = Buffer.from(
    createHash("sha256").update(parts.join("\u001f")).digest().subarray(0, 16),
  );
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
