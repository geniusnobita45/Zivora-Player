"use client";
import { usePlayer, usePlayerStore } from "../PlayerContext";
import { ControlButton } from "./ControlButton";
export function VolumeControl() {
  const { perform } = usePlayer();
  const volume = usePlayerStore((s) => s.snapshot?.volume ?? 1);
  const muted = usePlayerStore((s) => s.snapshot?.muted ?? false);
  return (
    <div className="zivora-volume">
      <ControlButton
        label={muted ? "Unmute" : "Mute"}
        icon={muted || volume === 0 ? "muted" : "volume"}
        pressed={muted}
        onClick={() => perform((c) => c.setMuted(!muted))}
      />
      <input
        type="range"
        aria-label="Volume"
        min={0}
        max={1}
        step={0.05}
        value={muted ? 0 : volume}
        aria-valuetext={`${Math.round((muted ? 0 : volume) * 100)} percent`}
        onChange={(event) => {
          const level = event.currentTarget.valueAsNumber;
          perform(async (c) => {
            const result = await c.setMuted(false);
            return result.ok ? c.setVolume(level) : result;
          });
        }}
      />
    </div>
  );
}
