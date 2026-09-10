"use client";
import { usePlayer, usePlayerStore } from "../PlayerContext";
export function AudioMenu() {
  const { perform } = usePlayer();
  const tracks = usePlayerStore((s) => s.audioTracks);
  const selected = usePlayerStore((s) => s.snapshot?.audioTrackId);
  const languages = [...new Map(tracks.map((track) => [track.language, track])).values()];
  return (
    <label>
      Audio
      <select
        value={tracks.find((t) => t.id === selected)?.language ?? languages[0]?.language ?? ""}
        disabled={!tracks.length}
        onChange={(event) => {
          const language = event.currentTarget.value;
          perform((c) => c.selectAudio(language));
        }}
      >
        {!tracks.length && <option value="">No audio tracks</option>}
        {languages.map((track) => (
          <option key={track.language} value={track.language}>
            {track.label || track.language}
          </option>
        ))}
      </select>
    </label>
  );
}
