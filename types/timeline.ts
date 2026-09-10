import { z } from "zod";
const time = z.number().finite().min(0).max(86400);
const interval = { start: time, end: time };
const marker = { id: z.string().min(1).max(128), title: z.string().min(1).max(500), start: time };
const section = z
  .object({ ...marker, end: time })
  .strict()
  .refine((v) => v.end > v.start);
export const TimelineDataSchema = z
  .object({
    chapters: z.array(section).max(10000).default([]),
    scenes: z.array(section).max(100000).default([]),
    bookmarks: z.array(z.object(marker).strict()).max(10000).default([]),
    skipSegments: z
      .array(
        z
          .object({ ...marker, end: time, kind: z.enum(["intro", "outro", "recap", "other"]) })
          .strict()
          .refine((v) => v.end > v.start),
      )
      .max(10000)
      .default([]),
    thumbnails: z
      .array(
        z
          .object({
            ...interval,
            url: z
              .string()
              .url()
              .refine((s) => ["https:", "http:"].includes(new URL(s).protocol)),
            x: z.number().int().nonnegative(),
            y: z.number().int().nonnegative(),
            width: z.number().int().positive().max(4096),
            height: z.number().int().positive().max(4096),
          })
          .strict()
          .refine((v) => v.end > v.start),
      )
      .max(17280)
      .default([]),
  })
  .strict()
  .transform((v) => ({
    ...v,
    chapters: v.chapters.sort((a, b) => a.start - b.start),
    scenes: v.scenes.sort((a, b) => a.start - b.start),
    bookmarks: v.bookmarks.sort((a, b) => a.start - b.start),
    thumbnails: v.thumbnails.sort((a, b) => a.start - b.start),
  }));
export type TimelineData = z.infer<typeof TimelineDataSchema>;
export const EMPTY_TIMELINE: TimelineData = TimelineDataSchema.parse({});
