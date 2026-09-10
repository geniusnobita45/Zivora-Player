import { z } from "zod";

export const ManifestUrlSchema = z
  .string()
  .url()
  .refine((value) => {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password;
  }, "A manifest must use HTTP(S) without embedded credentials");
export const PositionSchema = z.number().finite().nonnegative();
export const VolumeSchema = z.number().finite().min(0).max(1);
export const RateSchema = z.number().finite().min(0.25).max(3);
export const TrackIdSchema = z.string().trim().min(1);

export const PlayerConfigSchema = z
  .object({
    abr: z
      .object({
        enabled: z.boolean().default(true),
        defaultBandwidthEstimate: z.number().finite().positive().default(1_000_000),
        switchInterval: z.number().finite().positive().default(8),
        bandwidthUpgradeTarget: z.number().finite().positive().max(1).default(0.85),
        bandwidthDowngradeTarget: z.number().finite().positive().max(1).default(0.95),
      })
      .strict()
      .default({}),
    buffer: z
      .object({
        bufferingGoal: z.number().finite().positive().default(30),
        rebufferingGoal: z.number().finite().positive().default(2),
        bufferBehind: z.number().finite().nonnegative().default(30),
      })
      .strict()
      .refine(
        (value) => value.rebufferingGoal <= value.bufferingGoal,
        "Rebuffering goal must not exceed buffering goal",
      )
      .default({}),
    retry: z
      .object({
        maxAttempts: z.number().int().min(1).max(10).default(3),
        baseDelay: z.number().finite().nonnegative().default(1_000),
        backoffFactor: z.number().finite().min(1).default(2),
        fuzzFactor: z.number().finite().min(0).max(1).default(0.5),
        timeout: z.number().finite().positive().default(30_000),
        stallTimeout: z.number().finite().positive().default(5_000),
        connectionTimeout: z.number().finite().positive().default(10_000),
      })
      .strict()
      .default({}),
    startupPosition: PositionSchema.default(0),
    autoplay: z.boolean().default(false),
    // Engine reloads are separate from Shaka's per-request retry policy.
    maxRecoveryAttempts: z.number().int().min(0).max(3).default(3),
  })
  .strict();

export type PlayerConfig = z.output<typeof PlayerConfigSchema>;
export type PlayerConfigInput = z.input<typeof PlayerConfigSchema>;
export function createPlayerConfig(input: PlayerConfigInput = {}): PlayerConfig {
  return PlayerConfigSchema.parse(input);
}
