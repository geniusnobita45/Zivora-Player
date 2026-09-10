import { z } from "zod";

const Identifier = z.string().uuid();
const Milliseconds = z.number().finite().nonnegative().max(86_400_000);
const Seconds = z.number().finite().nonnegative().max(86_400);
const Dimension = z.string().trim().min(1).max(80);

export const TelemetryContextSchema = z
  .object({
    sessionId: Identifier,
    userId: Identifier.nullable(),
    contentId: Identifier,
    episodeId: Identifier.nullable(),
    mediaVersionId: Identifier.nullable(),
    device: Dimension,
    browser: Dimension,
    os: Dimension,
    network: Dimension,
  })
  .strict();
export type TelemetryContext = z.infer<typeof TelemetryContextSchema>;

export const TelemetryErrorSchema = z
  .object({
    code: z.string().trim().min(1).max(120),
    category: z.enum(["network", "manifest", "media", "drm", "adapter", "unknown"]),
    fatal: z.boolean(),
    recoverable: z.boolean(),
  })
  .strict();
export type TelemetryError = z.infer<typeof TelemetryErrorSchema>;

export const TelemetryEventSchema = z
  .object({
    type: z.enum([
      "session_started",
      "playing",
      "paused",
      "session_snapshot",
      "ended",
      "buffering",
      "seek",
      "quality",
      "error",
    ]),
    at: z.string().datetime({ offset: true }),
    positionS: Seconds.nullable(),
    startupMs: Milliseconds.nullable().optional(),
    watchDurationMs: Milliseconds.nullable().optional(),
    totalBufferMs: Milliseconds.nullable().optional(),
    completionPercentage: z.number().finite().min(0).max(100).nullable().optional(),
    failedRequests: z.number().int().nonnegative().max(10_000).nullable().optional(),
    bufferDurationMs: Milliseconds.nullable().optional(),
    seekFromS: Seconds.nullable().optional(),
    seekToS: Seconds.nullable().optional(),
    seekLatencyMs: Milliseconds.nullable().optional(),
    renditionId: z.string().trim().min(1).max(120).nullable().optional(),
    renditionHeight: z.number().int().positive().max(16_384).nullable().optional(),
    renditionBitrate: z.number().int().positive().max(200_000_000).nullable().optional(),
    bandwidthEstimate: z.number().finite().nonnegative().max(10_000_000_000).nullable().optional(),
    error: TelemetryErrorSchema.nullable().optional(),
  })
  .strict()
  .superRefine((value, issue) => {
    if (value.type === "buffering" && value.bufferDurationMs == null)
      issue.addIssue({ code: z.ZodIssueCode.custom, message: "Buffer events require duration" });
    if (value.type === "seek" && (value.seekFromS == null || value.seekToS == null))
      issue.addIssue({ code: z.ZodIssueCode.custom, message: "Seek events require positions" });
    if (value.type === "quality" && value.renditionId == null)
      issue.addIssue({ code: z.ZodIssueCode.custom, message: "Quality events require rendition" });
    if (value.type === "error" && value.error == null)
      issue.addIssue({ code: z.ZodIssueCode.custom, message: "Error events require error data" });
  });
export type TelemetryEvent = z.infer<typeof TelemetryEventSchema>;

export const TelemetryBatchSchema = z
  .object({
    schemaVersion: z.literal(1),
    sentAt: z.string().datetime({ offset: true }),
    sessions: z
      .array(
        z
          .object({
            context: TelemetryContextSchema,
            events: z.array(TelemetryEventSchema).min(1).max(64),
          })
          .strict(),
      )
      .min(1)
      .max(1),
  })
  .strict();
export type TelemetryBatch = z.infer<typeof TelemetryBatchSchema>;
