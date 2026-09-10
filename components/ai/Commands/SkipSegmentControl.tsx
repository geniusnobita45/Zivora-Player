"use client";
import { useEffect, useState } from "react";
import { usePlayer, usePlayerStore } from "@/components/player/PlayerContext";

const preferenceKey = "zivora:auto-skip";
export function SkipSegmentControl() {
  const { timeline, perform } = usePlayer();
  const position = usePlayerStore((state) => state.snapshot?.position ?? -1);
  const [autoSkip, setAutoSkip] = useState(false);
  const segment = timeline?.skipSegments.find(
    (value) => position >= value.start && position < value.end,
  );
  useEffect(() => {
    try {
      setAutoSkip(window.localStorage.getItem(preferenceKey) === "true");
    } catch {
      /* preference is optional */
    }
  }, []);
  useEffect(() => {
    if (segment && autoSkip)
      perform((controller) =>
        controller.skipSegment(segment.id, { source: "ui", reason: "Auto-skip preference" }),
      );
  }, [autoSkip, perform, segment]);
  if (!segment) return null;
  return (
    <div className="absolute right-5 top-5 z-30 flex items-center gap-2 rounded-lg bg-slate-950/90 p-2 text-xs shadow-lg">
      <button
        type="button"
        className="rounded bg-violet-300 px-3 py-2 font-semibold text-slate-950"
        onClick={() =>
          perform((controller) =>
            controller.skipSegment(segment.id, { source: "ui", reason: `Skip ${segment.kind}` }),
          )
        }
      >
        Skip {segment.title}
      </button>
      <label className="flex items-center gap-1 text-slate-200">
        <input
          type="checkbox"
          checked={autoSkip}
          onChange={(event) => {
            const value = event.target.checked;
            setAutoSkip(value);
            try {
              window.localStorage.setItem(preferenceKey, String(value));
            } catch {
              /* preference is optional */
            }
          }}
        />{" "}
        Auto
      </label>
    </div>
  );
}
