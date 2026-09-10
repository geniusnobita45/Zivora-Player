"use client";
import { useStore } from "zustand";
import { SubtitlePreferencesSchema, type SubtitleStore } from "@/stores/subtitle.store";
import { usePlayer, usePlayerStore } from "../PlayerContext";
import { updatePlayerUI } from "@/stores/player.store";
export function SubtitleSettings({ subtitleStore }: { subtitleStore: SubtitleStore }) {
  const { controller, store } = usePlayer();
  const preferences = useStore(subtitleStore, (s) => s.preferences);
  const tracks = usePlayerStore((s) => s.textTracks);
  const languages = [...new Set(tracks.map((t) => t.language))];
  const change = (patch: Record<string, unknown>) => {
    const value = SubtitlePreferencesSchema.safeParse({ ...preferences, ...patch });
    if (!value.success) return;
    if ("language" in patch || "kind" in patch) {
      if (!controller) return;
      void controller
        .selectSubtitle(value.data.language, {}, value.data.kind)
        .then((result) => {
          if (result.ok)
            subtitleStore.setPreferences({
              ...subtitleStore.getState().preferences,
              language: value.data.language,
              kind: value.data.kind,
            });
          else updatePlayerUI(store, { notice: "That subtitle variant is unavailable." });
        })
        .catch(() => updatePlayerUI(store, { notice: "Subtitle selection could not complete." }));
    } else {
      subtitleStore.setPreferences(value.data);
      updatePlayerUI(store, { captionSize: value.data.size });
    }
  };
  const available = (kind: string) =>
    tracks.some(
      (t) =>
        t.language === preferences.language &&
        (t.kind === kind || (kind === "original" && t.kind === "subtitles")),
    );
  return (
    <>
      <label>
        Subtitles
        <select
          value={preferences.language ?? ""}
          onChange={(e) => {
            const language = e.currentTarget.value || null;
            const kinds = tracks
              .filter((t) => t.language === language)
              .map((t) => (t.kind === "subtitles" ? "original" : t.kind));
            const kind = kinds.includes(preferences.kind)
              ? preferences.kind
              : kinds.includes("original")
                ? "original"
                : (kinds[0] ?? "original");
            change({ language, kind });
          }}
        >
          <option value="">Off</option>
          {languages.map((language) => (
            <option key={language} value={language}>
              {language}
            </option>
          ))}
        </select>
      </label>
      <label>
        Translation style
        <select
          value={preferences.kind}
          disabled={!preferences.language}
          onChange={(e) => change({ kind: e.currentTarget.value })}
        >
          {["original", "literal", "natural"].map((kind) => (
            <option key={kind} value={kind} disabled={!available(kind)}>
              {kind}
            </option>
          ))}
        </select>
      </label>
      <label>
        Speaker names
        <input
          type="checkbox"
          checked={preferences.speakerNames}
          onChange={(e) => change({ speakerNames: e.currentTarget.checked })}
        />
      </label>
      <label>
        Context hints
        <input
          type="checkbox"
          checked={preferences.contextHints}
          onChange={(e) => change({ contextHints: e.currentTarget.checked })}
        />
      </label>
      <label>
        Caption size
        <select value={preferences.size} onChange={(e) => change({ size: e.currentTarget.value })}>
          <option value="normal">Standard</option>
          <option value="large">Large</option>
        </select>
      </label>
      <label>
        Caption position
        <select
          value={preferences.position}
          onChange={(e) => change({ position: e.currentTarget.value })}
        >
          <option value="bottom">Bottom</option>
          <option value="top">Top</option>
        </select>
      </label>
    </>
  );
}
