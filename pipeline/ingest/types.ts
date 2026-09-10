import { z } from "zod";

export const IngestStageSchema = z.enum([
  "PROBE",
  "VALIDATE",
  "TRANSCODE",
  "PACKAGE",
  "THUMBNAILS",
  "SUBTITLES",
  "TRANSCRIBE",
  "SCENES",
  "CHARACTERS",
  "EMBEDDINGS",
  "CHAPTERS",
  "RECAPS",
  "SKIP MARKERS",
  "UPLOAD NEW MEDIA VERSION",
  "VALIDATE CLOUD MEDIA",
  "TEST PLAYBACK",
  "REGISTER DATABASE",
  "ATOMIC PUBLISH",
  "READY",
]);
export type IngestStage = z.infer<typeof IngestStageSchema>;

export const IngestOptionsSchema = z
  .object({
    input: z.string().trim().min(1),
    contentId: z.string().uuid(),
    episodeId: z.string().uuid().nullable().default(null),
    output: z.string().trim().min(1).optional(),
    from: IngestStageSchema.optional(),
    skipAi: z.boolean().default(false),
    dryRun: z.boolean().default(false),
    rollback: z.boolean().default(false),
    subtitles: z
      .array(z.object({ language: z.string().min(1), path: z.string().min(1) }).strict())
      .default([]),
    subtitleEnrichment: z.string().min(1).optional(),
    checkpointPath: z.string().trim().min(1).optional(),
    logPath: z.string().trim().min(1).optional(),
    ffmpeg: z.string().min(1).default("ffmpeg"),
    ffprobe: z.string().min(1).default("ffprobe"),
  })
  .strict();
export type IngestOptions = z.infer<typeof IngestOptionsSchema>;

export interface IngestReport {
  input: string;
  contentId: string;
  episodeId: string | null;
  outputDirectory: string | null;
  dryRun: boolean;
  skippedAi: boolean;
  completedStages: IngestStage[];
  failedStage: IngestStage | null;
  mediaVersionId: string | null;
  reportPath: string;
  logPath: string;
  totalMs: number;
}
