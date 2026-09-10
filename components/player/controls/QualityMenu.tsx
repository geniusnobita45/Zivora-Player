"use client";
import { usePlayer, usePlayerStore } from "../PlayerContext";
export function QualityMenu() {
  const { perform } = usePlayer();
  const tracks = usePlayerStore((s) => s.qualities);
  const selected = usePlayerStore((s) => s.snapshot?.qualityId ?? "auto");
  return (
    <label>
      Quality
      <select
        value={selected}
        onChange={(event) => {
          const id = event.currentTarget.value;
          perform((c) => (id === "auto" ? c.enableAutoQuality() : c.selectQuality(id)));
        }}
      >
        <option value="auto">Auto · adaptive</option>
        {tracks.map((track) => (
          <option key={track.id} value={track.id}>
            {track.height}p · {(track.bandwidth / 1_000_000).toFixed(1)} Mbps
          </option>
        ))}
      </select>
    </label>
  );
}
