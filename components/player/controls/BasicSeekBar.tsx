"use client";

import { useState } from "react";
import { usePlayer, usePlayerStore } from "../PlayerContext";
import { formatTime } from "../timeline/time";

/** Playback-only fallback used when timeline enrichment cannot render. */
export function BasicSeekBar() {
  const { perform } = usePlayer();
  const position = usePlayerStore((state) => state.snapshot?.position ?? 0);
  const duration = usePlayerStore((state) => state.snapshot?.duration ?? 0);
  const [draft, setDraft] = useState<number | null>(null);
  const value = draft ?? position;
  const commit = () => {
    if (draft !== null) perform((controller) => controller.seekTo(draft));
    setDraft(null);
  };
  return (
    <div className="zivora-timeline">
      <input
        type="range"
        aria-label="Seek"
        aria-valuetext={`${formatTime(value)} of ${formatTime(duration)}`}
        min={0}
        max={duration || 1}
        step={0.1}
        value={Math.min(value, duration || 1)}
        disabled={duration <= 0}
        onChange={(event) => setDraft(event.currentTarget.valueAsNumber)}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
      />
    </div>
  );
}
