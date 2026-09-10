import { z } from "zod";
export const WatchStateSchema = z
  .object({
    currentEpisodeOrder: z.number().int().nonnegative(),
    currentPosition: z.number().finite().min(0).max(86400),
    furthestEpisodeOrder: z.number().int().nonnegative(),
    furthestPosition: z.number().finite().min(0).max(86400),
  })
  .strict();
export const SpoilerModeSchema = z.enum(["strict_current", "watched_knowledge"]);
export const WatchBoundarySchema = z
  .object({
    boundary_episode_order: z.number().int().nonnegative(),
    boundary_seconds: z.number().finite().min(0).max(86400),
  })
  .strict();
export type WatchBoundary = z.infer<typeof WatchBoundarySchema>;
export type SpoilerMode = z.infer<typeof SpoilerModeSchema>;
export function computeWatchBoundary(stateInput: unknown, modeInput: unknown): WatchBoundary {
  const state = WatchStateSchema.parse(stateInput);
  const mode = SpoilerModeSchema.parse(modeInput);
  return WatchBoundarySchema.parse(
    mode === "strict_current"
      ? {
          boundary_episode_order: state.currentEpisodeOrder,
          boundary_seconds: state.currentPosition,
        }
      : {
          boundary_episode_order: state.furthestEpisodeOrder,
          boundary_seconds: state.furthestPosition,
        },
  );
}
export function withinBoundary(
  episodeOrder: number,
  end: number,
  boundary: WatchBoundary,
): boolean {
  return (
    Number.isInteger(episodeOrder) &&
    episodeOrder >= 0 &&
    Number.isFinite(end) &&
    end >= 0 &&
    (episodeOrder < boundary.boundary_episode_order ||
      (episodeOrder === boundary.boundary_episode_order && end <= boundary.boundary_seconds))
  );
}
