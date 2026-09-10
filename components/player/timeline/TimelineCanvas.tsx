"use client";
import { useEffect, useRef } from "react";
import { timeToPixel, type TimeWindow } from "@/core/streaming/TimelineMath";
import type { TimelineData } from "@/types/timeline";
import type { BufferedRange } from "@/core/player/PlayerEvents";

export function TimelineCanvas({
  data,
  window,
  width,
  position,
  buffered,
}: {
  data: TimelineData;
  window: TimeWindow;
  width: number;
  position: number;
  buffered: readonly BufferedRange[];
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || width <= 0 || typeof CanvasRenderingContext2D === "undefined") return;
    let ctx: CanvasRenderingContext2D | null;
    try {
      ctx = canvas.getContext("2d");
    } catch {
      return;
    }
    if (!ctx) return;
    const ratio = Math.min(globalThis.devicePixelRatio || 1, 3);
    canvas.width = Math.ceil(width * ratio);
    canvas.height = 44 * ratio;
    ctx.scale(ratio, ratio);
    const x = (t: number) => timeToPixel(t, window, width);
    const region = (start: number, end: number, color: string, y: number, height: number) => {
      if (end < window.start || start > window.end) return;
      ctx.fillStyle = color;
      ctx.fillRect(x(start), y, Math.max(1, x(end) - x(start)), height);
    };
    region(window.start, window.end, "#334155", 20, 4);
    buffered.forEach((r) => region(r.start, r.end, "#94a3b8", 20, 4));
    region(window.start, position, "#a78bfa", 20, 4);
    data.skipSegments.forEach((r) =>
      region(
        r.start,
        r.end,
        { intro: "#f59e0b", outro: "#f472b6", recap: "#38bdf8", other: "#34d399" }[r.kind],
        29,
        5,
      ),
    );
    const occupied = new Set<number>();
    for (const chapter of data.chapters) {
      if (chapter.start < window.start || chapter.start > window.end) continue;
      const pixel = Math.floor(x(chapter.start));
      if (occupied.has(pixel)) continue;
      occupied.add(pixel);
      ctx.fillStyle = "#f8fafc";
      ctx.fillRect(pixel, 14, 1, 14);
    }
    for (const bookmark of data.bookmarks) {
      if (bookmark.start < window.start || bookmark.start > window.end) continue;
      ctx.fillStyle = "#fbbf24";
      ctx.fillRect(x(bookmark.start) - 2, 5, 4, 8);
    }
    if (position >= window.start && position <= window.end) {
      ctx.fillStyle = "white";
      ctx.beginPath();
      ctx.arc(x(position), 22, 6, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [data, window, width, position, buffered]);
  return <canvas ref={ref} aria-hidden="true" className="zivora-timeline-canvas" />;
}
