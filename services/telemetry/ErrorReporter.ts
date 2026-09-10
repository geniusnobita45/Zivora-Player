import { TelemetryErrorSchema, type TelemetryError } from "@/types/telemetry";
import { toPlaybackError } from "@/core/player/PlayerErrors";

/** Captures stable error metadata only: no messages, stacks, URLs, or causes leave the player. */
export class ErrorReporter {
  capture(input: unknown): TelemetryError {
    const error = toPlaybackError(input);
    return TelemetryErrorSchema.parse({
      code: error.code,
      category: error.category,
      fatal: error.fatal,
      recoverable: error.recoverable,
    });
  }
}
