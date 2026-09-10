import { z } from "zod";
import { TimelineDataSchema } from "./timeline";
export const WatchItemSchema = z
  .object({
    contentId: z.string().uuid(),
    episodeId: z.string().uuid().nullable(),
    title: z.string().min(1).max(1000),
    description: z.string().max(2000).default(""),
  })
  .strict();
export type WatchItem = z.infer<typeof WatchItemSchema>;
export const WatchSelectionSchema = z
  .object({
    current: WatchItemSchema,
    next: WatchItemSchema.nullable(),
    userId: z.string().uuid().nullable().optional(),
    timeline: TimelineDataSchema.optional(),
  })
  .strict();
export function watchHref(item: WatchItem): string {
  const value = WatchItemSchema.parse(item);
  return `/watch/${value.contentId}${value.episodeId ? `?episode=${value.episodeId}` : ""}`;
}
