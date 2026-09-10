"use client";

import { useDegradation } from "./PlayerContext";

export function DegradationIndicator() {
  const state = useDegradation();
  if (state.level === 0) return null;
  return (
    <span
      className="zivora-degradation-indicator"
      role="status"
      aria-live="polite"
      title={`Some optional features are temporarily unavailable. Playback continues in ${state.label.toLowerCase()} mode.`}
    >
      Playback mode · L{state.level}
    </span>
  );
}
