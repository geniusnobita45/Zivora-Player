import { z } from "zod";
import { WatchStateSchema } from "../spoiler-guard/WatchBoundary";
export const MediaScopeSchema = z
  .array(
    z
      .object({
        episode_id: z.string().uuid().nullable(),
        episode_order: z.number().int().nonnegative(),
        media_version_id: z.string().uuid(),
        duration_s: z.number().finite().positive().max(86400),
      })
      .strict(),
  )
  .min(1)
  .max(10000);
const ProgressSchema = z.array(
  z.object({
    episode_id: z.string().uuid().nullable(),
    furthest_position_s: z.number().finite().min(0).max(86400),
  }),
);
/** Current position is live client state; past knowledge comes from authenticated stored progress. */
export function resolveWatchState(
  input: unknown,
  episodeId: string | null,
  mediaInput: unknown,
  progressInput: unknown,
) {
  const sent = WatchStateSchema.parse(input),
    media = MediaScopeSchema.parse(mediaInput);
  const current = media.find((row) => row.episode_id === episodeId);
  if (!current || sent.currentPosition > current.duration_s)
    throw new Error("Playback state does not match the active episode");
  let order = current.episode_order,
    position = sent.currentPosition;
  for (const row of ProgressSchema.parse(progressInput)) {
    const item = media.find((entry) => entry.episode_id === row.episode_id);
    if (!item) continue;
    const seconds = Math.min(row.furthest_position_s, item.duration_s);
    if (item.episode_order > order || (item.episode_order === order && seconds > position)) {
      order = item.episode_order;
      position = seconds;
    }
  }
  return {
    state: WatchStateSchema.parse({
      ...sent,
      currentEpisodeOrder: current.episode_order,
      furthestEpisodeOrder: order,
      furthestPosition: position,
    }),
    duration: current.duration_s,
    media,
  };
}
