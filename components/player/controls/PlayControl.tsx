"use client";
import { usePlayer, usePlayerStore } from "../PlayerContext";
import { ControlButton } from "./ControlButton";
export function PlayControl() {
  const { perform } = usePlayer();
  const paused = usePlayerStore((s) => s.snapshot?.paused ?? true);
  return (
    <ControlButton
      label={paused ? "Play" : "Pause"}
      icon={paused ? "play" : "pause"}
      onClick={() => perform((c) => c.togglePlay())}
    />
  );
}
