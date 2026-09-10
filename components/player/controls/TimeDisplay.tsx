"use client";
import { usePlayerStore } from "../PlayerContext";
import { formatTime } from "../timeline/time";
export function TimeDisplay() {
  const position = usePlayerStore((s) => s.snapshot?.position ?? 0);
  const duration = usePlayerStore((s) => s.snapshot?.duration ?? 0);
  return (
    <span className="zivora-time" aria-label="Playback time">
      <span>{formatTime(position)}</span>
      <span className="zivora-muted"> / {formatTime(duration)}</span>
    </span>
  );
}
