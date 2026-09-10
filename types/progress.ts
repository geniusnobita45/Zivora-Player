import { z } from "zod";

export const PlaybackTargetSchema = z
  .object({
    contentId: z.string().uuid(),
    episodeId: z.string().uuid().nullable(),
  })
  .strict();
export type PlaybackTarget = z.infer<typeof PlaybackTargetSchema>;
export const ProgressRecordSchema = PlaybackTargetSchema.extend({
  userId: z.string().uuid().nullable(),
  sessionId: z.string().uuid().nullable().default(null),
  position: z.number().finite().min(0).max(86400),
  duration: z.number().finite().positive().max(86400),
  furthestPosition: z.number().finite().min(0).max(86400),
  updatedAt: z.string().datetime({ offset: true }),
}).refine((v) => v.position <= v.duration && v.furthestPosition >= v.position);
export type ProgressRecord = z.infer<typeof ProgressRecordSchema>;
export function progressKey(target: PlaybackTarget, userId: string | null): string {
  return `${userId ?? "guest"}:${target.contentId}:${target.episodeId ?? "movie"}`;
}
/** Equal timestamps retain the existing value; rewind never rolls back the high-water mark. */
export function mergeProgress(
  existing: ProgressRecord | null,
  incoming: ProgressRecord,
): ProgressRecord {
  const next = ProgressRecordSchema.parse(incoming);
  if (!existing) return next;
  const old = ProgressRecordSchema.parse(existing);
  if (progressKey(old, old.userId) !== progressKey(next, next.userId))
    throw new Error("Progress scope mismatch");
  const latest = Date.parse(next.updatedAt) > Date.parse(old.updatedAt) ? next : old;
  return { ...latest, furthestPosition: Math.max(old.furthestPosition, next.furthestPosition) };
}
export const BookmarkSchema = PlaybackTargetSchema.extend({
  id: z.string().uuid(),
  userId: z.string().uuid().nullable(),
  position: z.number().finite().min(0).max(86400),
  title: z.string().trim().min(1).max(300),
  updatedAt: z.string().datetime({ offset: true }),
  deleted: z.boolean().default(false),
});
export type Bookmark = z.infer<typeof BookmarkSchema>;
