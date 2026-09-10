import { describe, expect, it } from "vitest";
import {
  timelineWindow,
  timeToPixel,
  pixelToTime,
  zoomAt,
  precisionTime,
  visibleLabels,
  ZOOM_LEVELS,
} from "@/core/streaming/TimelineMath";
import { TimelineDataSchema } from "@/types/timeline";
describe("24-hour timeline math", () => {
  it.each([
    ["GLOBAL", 86400],
    ["HOUR", 3600],
    ["MINUTES", 300],
    ["SECONDS", 30],
  ] as const)("computes %s span", (level, span) => {
    const window = timelineWindow(86400, level, 43200);
    expect(window.end - window.start).toBe(span);
  });
  it("keeps pointer time anchored at each zoom transition", () => {
    for (const level of ZOOM_LEVELS.slice(1)) {
      const window = timelineWindow(86400, level, 7200, 0.2);
      expect(pixelToTime(200, window, 1000)).toBeCloseTo(7200);
    }
  });
  it("bounds the first/last window and handles short and empty content", () => {
    expect(timelineWindow(86400, "SECONDS", 86400)).toEqual({ start: 86370, end: 86400 });
    expect(timelineWindow(10, "HOUR", 0)).toEqual({ start: 0, end: 10 });
    expect(timelineWindow(0, "GLOBAL", 0)).toEqual({ start: 0, end: 0 });
    expect(timeToPixel(0, { start: 0, end: 0 }, 0)).toBe(0);
    expect(pixelToTime(10, { start: 5, end: 6 }, 0)).toBe(5);
  });
  it("round trips fractional seconds throughout 24 hours", () => {
    for (let time = 0; time <= 86400; time += 31.7) {
      const window = timelineWindow(86400, "MINUTES", time);
      expect(pixelToTime(timeToPixel(time, window, 381), window, 381)).toBeCloseTo(time, 8);
    }
  });
  it("rejects malformed bounds and caps zoom", () => {
    expect(() => timelineWindow(86401, "GLOBAL", 0)).toThrow();
    expect(() => timeToPixel(NaN, { start: 0, end: 1 }, 100)).toThrow();
    expect(zoomAt("GLOBAL", -1)).toBe("GLOBAL");
    expect(zoomAt("SECONDS", 1)).toBe("SECONDS");
  });
  it("uses level-specific keyboard precision and clamps at edges", () => {
    expect(ZOOM_LEVELS.map((level) => precisionTime(1, 1, level, 86400))).toEqual([61, 11, 2, 1.1]);
    expect(precisionTime(86399.99, 1, "SECONDS", 86400)).toBe(86400);
    expect(precisionTime(0, -1, "GLOBAL", 86400)).toBe(0);
  });
  it("limits labels for dense scene inventories and validates metadata", () => {
    const data = Array.from({ length: 100000 }, (_, i) => ({
      start: i * 0.8,
      title: `Scene ${i}`,
    }));
    expect(visibleLabels(data, { start: 0, end: 86400 }, 400).length).toBeLessThanOrEqual(4);
    expect(() =>
      TimelineDataSchema.parse({ bookmarks: [{ id: "a", title: "b", start: Infinity }] }),
    ).toThrow();
  });
  it("retains titles of chapters spanning the entire zoom window", () => {
    const chapter = { start: 0, end: 7200, title: "Long chapter" };
    expect(visibleLabels([chapter], { start: 1800, end: 2100 }, 400)).toEqual([chapter]);
  });
});
