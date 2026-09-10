import { z } from "zod";

export const MAX_TIMELINE_SECONDS = 24 * 60 * 60;
export const ZoomLevelSchema = z.enum(["GLOBAL", "HOUR", "MINUTES", "SECONDS"]);
export type ZoomLevel = z.infer<typeof ZoomLevelSchema>;
export const ZOOM_LEVELS = ZoomLevelSchema.options;
export const PRECISION_STEP: Record<ZoomLevel, number> = {
  GLOBAL: 60,
  HOUR: 10,
  MINUTES: 1,
  SECONDS: 0.1,
};
export const TimeWindowSchema = z
  .object({
    start: z.number().finite().nonnegative(),
    end: z.number().finite().nonnegative().max(MAX_TIMELINE_SECONDS),
  })
  .strict()
  .refine((v) => v.end >= v.start);
export type TimeWindow = z.infer<typeof TimeWindowSchema>;
const finite = z.number().finite();
export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
export function timelineWindow(
  duration: number,
  level: ZoomLevel,
  anchor: number,
  fraction = 0.5,
): TimeWindow {
  const total = finite.min(0).max(MAX_TIMELINE_SECONDS).parse(duration);
  ZoomLevelSchema.parse(level);
  const span = Math.min(total, { GLOBAL: total, HOUR: 3600, MINUTES: 300, SECONDS: 30 }[level]);
  const start = clamp(
    clamp(finite.parse(anchor), 0, total) - span * clamp(finite.parse(fraction), 0, 1),
    0,
    total - span,
  );
  return { start, end: start + span };
}
export function timeToPixel(time: number, window: TimeWindow, width: number): number {
  const { start, end } = TimeWindowSchema.parse(window);
  const pixels = finite.min(0).parse(width);
  return end === start ? 0 : clamp((finite.parse(time) - start) / (end - start), 0, 1) * pixels;
}
export function pixelToTime(pixel: number, window: TimeWindow, width: number): number {
  const { start, end } = TimeWindowSchema.parse(window);
  const pixels = finite.min(0).parse(width);
  return pixels === 0 ? start : start + clamp(finite.parse(pixel) / pixels, 0, 1) * (end - start);
}
export function zoomAt(level: ZoomLevel, direction: number): ZoomLevel {
  return ZOOM_LEVELS[
    clamp(
      ZOOM_LEVELS.indexOf(ZoomLevelSchema.parse(level)) + Math.sign(finite.parse(direction)),
      0,
      3,
    )
  ];
}
export function precisionTime(
  time: number,
  direction: number,
  level: ZoomLevel,
  duration: number,
): number {
  const window = timelineWindow(duration, "GLOBAL", 0);
  return clamp(
    Math.round(
      (finite.parse(time) +
        Math.sign(finite.parse(direction)) * PRECISION_STEP[ZoomLevelSchema.parse(level)]) *
        1000,
    ) / 1000,
    window.start,
    window.end,
  );
}
/** Pixel buckets bound marker work and label density independently of a 24h inventory. */
export function visibleLabels<T extends { start: number; end?: number; title: string }>(
  items: readonly T[],
  window: TimeWindow,
  width: number,
  spacing = 130,
): T[] {
  TimeWindowSchema.parse(window);
  finite.min(0).parse(width);
  finite.positive().parse(spacing);
  const scale = window.end > window.start ? width / (window.end - window.start) : 0;
  let last = -Infinity;
  return items.filter((item) => {
    if (
      (item.start < window.start && (item.end === undefined || item.end <= window.start)) ||
      item.start > window.end
    )
      return false;
    // The metadata boundary validates items once; do not reparse a window per marker.
    const x = clamp((item.start - window.start) * scale, 0, width);
    if (x - last < spacing) return false;
    last = x;
    return true;
  });
}
