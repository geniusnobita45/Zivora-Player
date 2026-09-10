"use client";
import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  clamp,
  pixelToTime,
  timeToPixel,
  timelineWindow,
  zoomAt,
  precisionTime,
  visibleLabels,
  PRECISION_STEP,
  type TimeWindow,
  type ZoomLevel,
} from "@/core/streaming/TimelineMath";
import { EMPTY_TIMELINE } from "@/types/timeline";
import { useDegradation, usePlayer, usePlayerStore } from "../PlayerContext";
import { formatTime } from "./time";
import { TimelineCanvas } from "./TimelineCanvas";

const emptySubscribe = () => () => {};
const zero = () => 0;
export function Timeline() {
  const { perform, timeline: supplied = EMPTY_TIMELINE, bookmarks, item } = usePlayer();
  const degradation = useDegradation();
  const revision = useSyncExternalStore(
    bookmarks?.subscribe ?? emptySubscribe,
    bookmarks?.getRevision ?? zero,
    zero,
  );
  const timeline = useMemo(() => {
    // The manager retains its identity; its revision invalidates this derived marker list.
    void revision;
    return {
      ...supplied,
      chapters: degradation.level < 3 ? supplied.chapters : [],
      scenes: degradation.level < 3 ? supplied.scenes : [],
      thumbnails: degradation.level < 3 ? supplied.thumbnails : [],
      bookmarks: [
        ...new Map(
          [
            ...supplied.bookmarks,
            ...(bookmarks?.list(item) ?? []).map((b) => ({
              id: b.id,
              title: b.title,
              start: b.position,
            })),
          ].map((b) => [b.id, b]),
        ).values(),
      ].sort((a, b) => a.start - b.start),
    };
  }, [supplied, bookmarks, item, revision, degradation.level]);
  const position = usePlayerStore((s) => s.snapshot?.position ?? 0);
  const duration = usePlayerStore((s) => s.snapshot?.duration ?? 0);
  const buffered = usePlayerStore((s) => s.bufferedRanges);
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1);
  const [view, setView] = useState<{ level: ZoomLevel; window: TimeWindow } | null>(null);
  const [draft, setDraft] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const points = useRef(new Map<number, number>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pinch = useRef(0);
  const wheel = useRef<(event: WheelEvent) => void>(() => {});
  const latest = useRef({ draft, view, duration });
  latest.current = { draft, view, duration };
  const level = view?.level ?? "GLOBAL";
  const window = view?.window ?? timelineWindow(Math.min(duration, 86400), "GLOBAL", 0);
  const shown = draft ?? position;
  const description = useId();
  const clearTimer = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  };
  const cancel = () => {
    clearTimer();
    points.current.clear();
    pinch.current = 0;
    setDraft(null);
    setView(null);
    setHover(null);
    latest.current.draft = null;
    latest.current.view = null;
  };
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const resize = () => setWidth(Math.max(1, element.getBoundingClientRect().width - 14));
    resize();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(resize);
    observer?.observe(element);
    const scroll = (event: WheelEvent) => wheel.current(event);
    element.addEventListener("wheel", scroll, { passive: false });
    return () => {
      observer?.disconnect();
      clearTimer();
      element.removeEventListener("wheel", scroll);
    };
  }, []);
  useEffect(() => {
    cancel(); /* A replacement duration invalidates the previous window. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [duration]);
  const geometry = (clientX: number) => {
    const rect = ref.current!.getBoundingClientRect();
    const w = Math.max(1, rect.width - 14);
    const fraction = clamp((clientX - rect.left - 7) / w, 0, 1);
    return {
      fraction,
      time: pixelToTime(
        fraction * w,
        latest.current.view?.window ?? timelineWindow(Math.min(duration, 86400), "GLOBAL", 0),
        w,
      ),
    };
  };
  const zoom = (clientX: number, direction: number) => {
    const anchor = geometry(clientX);
    const next = zoomAt(latest.current.view?.level ?? "GLOBAL", direction);
    const nextView = {
      level: next,
      window: timelineWindow(Math.min(duration, 86400), next, anchor.time, anchor.fraction),
    };
    latest.current.view = nextView;
    latest.current.draft = anchor.time;
    setView(nextView);
    setDraft(anchor.time);
    setHover(anchor.time);
  };
  wheel.current = (event) => {
    if (!duration || duration > 86400 || !event.deltaY) return;
    event.preventDefault();
    event.stopPropagation();
    zoom(event.clientX, event.deltaY < 0 ? 1 : -1);
  };
  const hold = (clientX: number) => {
    timer.current = setTimeout(() => {
      if (points.current.size !== 1) return;
      zoom(points.current.values().next().value ?? clientX, 1);
      if (latest.current.view?.level !== "SECONDS") hold(clientX);
    }, 550);
  };
  const commit = (value: number | null) => {
    if (value !== null) perform((c) => c.seekTo(value));
    cancel();
  };
  const previewTime = hover ?? shown;
  const thumbnail = timeline.thumbnails.find((t) => t.start <= previewTime && t.end > previewTime);
  const chapters = visibleLabels(timeline.chapters, window, width);
  const scenes = level === "GLOBAL" ? [] : visibleLabels(timeline.scenes, window, width);
  const currentChapter = timeline.chapters.find(
    (c) => c.start <= previewTime && c.end > previewTime,
  );
  const currentScene =
    level === "GLOBAL"
      ? null
      : timeline.scenes.find((s) => s.start <= previewTime && s.end > previewTime);
  return (
    <div ref={ref} className="zivora-precision-timeline" data-zoom={level}>
      <div className="zivora-timeline-labels" aria-hidden="true">
        {chapters.map((c) => (
          <span
            key={c.id}
            title={c.title}
            style={{ left: `${(timeToPixel(c.start, window, width) / width) * 100}%` }}
          >
            {c.title}
          </span>
        ))}
      </div>
      <div className="zivora-timeline-hit">
        <TimelineCanvas
          data={timeline}
          window={window}
          width={width}
          position={shown}
          buffered={buffered}
        />
        <input
          type="range"
          aria-label="Seek"
          aria-describedby={description}
          aria-valuetext={`${formatTime(shown)} of ${formatTime(duration)}; ${level.toLowerCase()} view`}
          min={window.start}
          max={window.end || 1}
          step={0.001}
          value={clamp(shown, window.start, window.end || 1)}
          disabled={duration <= 0 || duration > 86400}
          onChange={(e) => {
            setDraft(e.currentTarget.valueAsNumber);
            latest.current.draft = e.currentTarget.valueAsNumber;
          }}
          onPointerDown={(e) => {
            e.preventDefault();
            e.currentTarget.focus({ preventScroll: true });
            e.stopPropagation();
            e.currentTarget.setPointerCapture?.(e.pointerId);
            points.current.set(e.pointerId, e.clientX);
            clearTimer();
            const time = geometry(e.clientX).time;
            latest.current.draft = time;
            setDraft(time);
            if (points.current.size === 1) hold(e.clientX);
            else {
              const p = [...points.current.values()];
              pinch.current = Math.abs(p[0] - p[1]);
            }
          }}
          onPointerMove={(e) => {
            const time = geometry(e.clientX).time;
            setHover(time);
            if (!points.current.has(e.pointerId)) return;
            e.preventDefault();
            points.current.set(e.pointerId, e.clientX);
            if (points.current.size >= 2) {
              const p = [...points.current.values()];
              const distance = Math.abs(p[0] - p[1]);
              if (
                pinch.current > 0 &&
                (distance / pinch.current > 1.35 || distance / pinch.current < 0.74)
              ) {
                zoom((p[0] + p[1]) / 2, distance > pinch.current ? 1 : -1);
                pinch.current = distance;
              }
              const center = geometry((p[0] + p[1]) / 2).time;
              setDraft(center);
              latest.current.draft = center;
            } else {
              setDraft(time);
              latest.current.draft = time;
            }
          }}
          onPointerUp={(e) => {
            e.stopPropagation();
            if (!points.current.has(e.pointerId)) return;
            points.current.delete(e.pointerId);
            if (!points.current.size) commit(latest.current.draft);
          }}
          onPointerCancel={cancel}
          onLostPointerCapture={(e) => {
            if (points.current.has(e.pointerId)) cancel();
          }}
          onBlur={cancel}
          onPointerLeave={() => {
            if (!points.current.size) setHover(null);
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Escape") {
              e.preventDefault();
              cancel();
              return;
            }
            if (["+", "=", "-"].includes(e.key)) {
              e.preventDefault();
              const rect = ref.current!.getBoundingClientRect();
              zoom(rect.left + rect.width / 2, e.key === "-" ? -1 : 1);
              return;
            }
            if (
              ![
                "ArrowLeft",
                "ArrowRight",
                "ArrowUp",
                "ArrowDown",
                "Home",
                "End",
                "PageUp",
                "PageDown",
                "Enter",
              ].includes(e.key)
            )
              return;
            e.preventDefault();
            if (e.key === "Enter") {
              commit(latest.current.draft);
              return;
            }
            let time = latest.current.draft ?? position;
            if (e.key === "Home") time = window.start;
            else if (e.key === "End") time = window.end;
            else
              time = precisionTime(
                time,
                ["ArrowLeft", "ArrowDown", "PageDown"].includes(e.key) ? -1 : 1,
                level,
                duration,
              );
            if (time < window.start || time > window.end)
              setView({ level, window: timelineWindow(duration, level, time) });
            setDraft(time);
            latest.current.draft = time;
          }}
          onKeyUp={(e) => {
            if (
              [
                "ArrowLeft",
                "ArrowRight",
                "ArrowUp",
                "ArrowDown",
                "Home",
                "End",
                "PageUp",
                "PageDown",
              ].includes(e.key)
            ) {
              e.stopPropagation();
              commit(latest.current.draft);
            }
          }}
        />
      </div>
      <div className="zivora-timeline-labels zivora-scene-labels" aria-hidden="true">
        {scenes.map((s) => (
          <span
            key={s.id}
            title={s.title}
            style={{ left: `${(timeToPixel(s.start, window, width) / width) * 100}%` }}
          >
            {s.title}
          </span>
        ))}
      </div>
      <p id={description} className="sr-only">
        Hold, pinch, or scroll to zoom. Plus and minus change zoom. Arrows step{" "}
        {PRECISION_STEP[level]} seconds. Release to seek; Escape cancels.{" "}
        {timeline.bookmarks.length} bookmarks.{" "}
        {timeline.skipSegments
          .map((s) => `${s.kind}: ${s.title}, ${formatTime(s.start)} to ${formatTime(s.end)}`)
          .join(". ")}
      </p>
      {(hover !== null || draft !== null || view) && (
        <div className="zivora-timeline-preview" role="status">
          {thumbnail && (
            <div
              role="img"
              aria-label={`Preview at ${formatTime(previewTime)}`}
              style={{
                width: thumbnail.width / 2,
                height: thumbnail.height / 2,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: thumbnail.width,
                  height: thumbnail.height,
                  backgroundImage: `url(${JSON.stringify(thumbnail.url)})`,
                  backgroundPosition: `-${thumbnail.x}px -${thumbnail.y}px`,
                  transform: "scale(.5)",
                  transformOrigin: "top left",
                }}
              />
            </div>
          )}
          <span>
            {formatTime(previewTime)} · {level} ·{" "}
            {currentScene?.title ?? currentChapter?.title ?? "Seek preview"}
          </span>
          {timeline.bookmarks
            .filter((b) => Math.abs(b.start - previewTime) <= PRECISION_STEP[level])
            .slice(0, 3)
            .map((b) => (
              <span key={b.id}>Bookmark: {b.title}</span>
            ))}
        </div>
      )}
    </div>
  );
}
