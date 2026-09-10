import { z } from "zod";

const Numeric = z.number().finite().nullable();
export const StartupMetricSchema = z
  .object({ samples: Numeric, p50_ms: Numeric, p95_ms: Numeric })
  .strict();
export const SeekMetricSchema = StartupMetricSchema;
export const RebufferMetricSchema = z.object({ samples: Numeric, ratio: Numeric }).strict();
export const ErrorRateMetricSchema = z
  .object({ sessions: Numeric, failed_sessions: Numeric, error_rate: Numeric })
  .strict();
export const QualityMetricSchema = z
  .object({
    device: z.string().nullable(),
    browser: z.string().nullable(),
    network: z.string().nullable(),
    rendition_id: z.string().nullable(),
    rendition_height: Numeric,
    rendition_bitrate: Numeric,
    selections: Numeric,
    average_bandwidth_estimate: Numeric,
  })
  .strict();
export const PlaybackMetricsSchema = z
  .object({
    startup: StartupMetricSchema,
    seek: SeekMetricSchema,
    rebuffer: RebufferMetricSchema,
    errors: ErrorRateMetricSchema,
    quality: z.array(QualityMetricSchema).max(1000),
  })
  .strict();
export type PlaybackMetrics = z.infer<typeof PlaybackMetricsSchema>;

export function displayMilliseconds(value: number | null): string {
  return value === null ? "—" : `${Math.round(value).toLocaleString()} ms`;
}
export function displayPercent(value: number | null): string {
  return value === null ? "—" : `${(value * 100).toFixed(2)}%`;
}
export function isAnalyticsAdmin(input: unknown): boolean {
  return z
    .object({ app_metadata: z.object({ is_admin: z.literal(true) }).passthrough() })
    .passthrough()
    .safeParse(input).success;
}
