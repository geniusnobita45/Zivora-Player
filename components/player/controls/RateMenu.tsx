"use client";
import { usePlayer, usePlayerStore } from "../PlayerContext";
export function RateMenu() {
  const { perform } = usePlayer();
  const rate = usePlayerStore((s) => s.snapshot?.rate ?? 1);
  return (
    <label>
      Speed
      <select
        value={rate}
        onChange={(event) => {
          const value = Number(event.currentTarget.value);
          perform((c) => c.setPlaybackRate(value));
        }}
      >
        {[0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3].map((value) => (
          <option key={value} value={value}>
            {value === 1 ? "1× · normal" : `${value}×`}
          </option>
        ))}
      </select>
    </label>
  );
}
