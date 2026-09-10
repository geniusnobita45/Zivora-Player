"use client";
import { usePlayer, usePlayerStore } from "../PlayerContext";
export function SubtitleMenu() {
  const { perform } = usePlayer();
  const tracks = usePlayerStore((s) => s.textTracks);
  const selected = usePlayerStore((s) => s.snapshot?.textTrackId);
  const languages = [...new Map(tracks.map((track) => [track.language, track])).values()];
  return (
    <label>
      Subtitles
      <select
        value={tracks.find((t) => t.id === selected)?.language ?? ""}
        onChange={(event) => {
          const language = event.currentTarget.value || null;
          perform((c) => c.selectSubtitle(language));
        }}
      >
        <option value="">Off</option>
        {languages.map((track) => (
          <option key={track.language} value={track.language}>
            {track.label || track.language}
          </option>
        ))}
      </select>
    </label>
  );
}
