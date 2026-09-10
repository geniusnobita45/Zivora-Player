import { z } from "zod";
import { PlayerCommandSchema, SkipSegmentSchema, type PlayerCommand } from "./PlayerCommand";
import type { Result } from "@/types/result";

export interface ValidationError {
  code: "INVALID_COMMAND" | "INVALID_CONTEXT" | "RATE_LIMITED" | "UNKNOWN_SEGMENT";
  message: string;
  retryAfterMs?: number;
}
export const CommandContextSchema = z.object({
  position: z.number().finite().nonnegative(),
  duration: z.number().finite().nonnegative(),
  skipSegments: z.array(SkipSegmentSchema).default([]),
});
export type CommandContext = z.input<typeof CommandContextSchema>;
export const clampSeek = (seconds: number, duration: number): number =>
  Math.max(0, Math.min(seconds, duration));

/** One instance per controller/session. Failed validation never consumes quota. */
export class PlayerCommandValidator {
  private aiCommands: number[] = [];
  private lastAiSeek = -Infinity;
  private lastNow = 0;
  constructor(private readonly now: () => number = Date.now) {}

  parse(input: unknown, context: CommandContext): Result<PlayerCommand, ValidationError> {
    try {
      const parsed = PlayerCommandSchema.safeParse(input);
      if (!parsed.success)
        return {
          ok: false,
          error: {
            code: "INVALID_COMMAND",
            message: "Command does not match the player command schema",
          },
        };
      const state = CommandContextSchema.safeParse(context);
      if (!state.success)
        return {
          ok: false,
          error: {
            code: "INVALID_CONTEXT",
            message: "Playback position and duration must be finite and nonnegative",
          },
        };
      let command = parsed.data;
      const { duration, position, skipSegments } = state.data;
      if (command.type === "SEEK_TO")
        command = { ...command, seconds: clampSeek(command.seconds, duration) };
      if (command.type === "SEEK_BY") {
        const origin = clampSeek(position, duration);
        command = { ...command, delta: clampSeek(origin + command.delta, duration) - origin };
      }
      if (
        command.type === "SKIP_SEGMENT" &&
        !skipSegments.some((segment) => segment.id === command.segmentId)
      ) {
        return {
          ok: false,
          error: {
            code: "UNKNOWN_SEGMENT",
            message: "Skip segment is not registered for this media",
          },
        };
      }
      if (command.source === "ai") {
        const clock = z.number().finite().nonnegative().parse(this.now());
        const now = Math.max(clock, this.lastNow);
        this.lastNow = now;
        this.aiCommands = this.aiCommands.filter((at) => now - at < 10_000);
        const seek = ["SEEK_TO", "SEEK_BY", "SKIP_SEGMENT"].includes(command.type);
        const wait = Math.max(
          this.aiCommands.length >= 5 ? this.aiCommands[0] + 10_000 - now : 0,
          seek ? this.lastAiSeek + 2_000 - now : 0,
        );
        if (wait > 0)
          return {
            ok: false,
            error: {
              code: "RATE_LIMITED",
              message: "AI command rate limit exceeded",
              retryAfterMs: Math.ceil(wait),
            },
          };
        this.aiCommands.push(now);
        if (seek) this.lastAiSeek = now;
      }
      return { ok: true, value: Object.freeze(command) };
    } catch {
      return {
        ok: false,
        error: {
          code: "INVALID_COMMAND",
          message: "Command or validation context could not be read",
        },
      };
    }
  }
}
