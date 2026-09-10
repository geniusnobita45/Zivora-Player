"use client";
import { useEffect, useState } from "react";
import { DegradationManager } from "@/services/degradation/DegradationManager";
export function SettingsPanel() {
  const [message, setMessage] = useState("");
  const [values, setValues] = useState({
    autoplay: true,
    subtitles_enabled: false,
    ai_enabled: true,
    voice_enabled: false,
    auto_skip: false,
    preferred_subtitle_language: "",
  });
  const [degradation] = useState(() => new DegradationManager());
  const [level, setLevel] = useState(degradation.getSnapshot().level);
  useEffect(() => {
    const stop = degradation.subscribe(() => setLevel(degradation.getSnapshot().level));
    void fetch("/api/preferences")
      .then((result) => (result.ok ? result.json() : null))
      .then((data) => {
        if (!data) return;
        setValues((current) => ({
          ...current,
          autoplay: data.base?.autoplay ?? current.autoplay,
          subtitles_enabled: data.base?.subtitles_enabled ?? current.subtitles_enabled,
          preferred_subtitle_language: data.base?.preferred_subtitle_language ?? "",
          ai_enabled: data.ai?.enabled ?? current.ai_enabled,
          voice_enabled: data.ai?.settings?.voice_enabled ?? current.voice_enabled,
          auto_skip: data.ai?.settings?.auto_skip ?? current.auto_skip,
        }));
      })
      .catch(() => undefined);
    return () => {
      stop();
      degradation.dispose();
    };
  }, [degradation]);
  const save = async () => {
    try {
      window.localStorage.setItem("zivora:voice-enabled", String(values.voice_enabled));
    } catch {
      /* optional preference */
    }
    const result = await fetch("/api/preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });
    setMessage(result.ok ? "Saved." : "Could not save preferences.");
  };
  return (
    <div className="max-w-2xl space-y-8">
      <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
        <h2 className="text-xl font-semibold">Playback</h2>
        <label className="mt-4 flex gap-3">
          <input
            type="checkbox"
            checked={values.autoplay}
            onChange={(event) => setValues({ ...values, autoplay: event.target.checked })}
          />{" "}
          Start playback automatically
        </label>
        <label className="mt-3 flex gap-3">
          <input
            type="checkbox"
            checked={values.auto_skip}
            onChange={(event) => setValues({ ...values, auto_skip: event.target.checked })}
          />{" "}
          Auto-skip intro, recap, and credits
        </label>
      </section>
      <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
        <h2 className="text-xl font-semibold">Subtitles and AI</h2>
        <label className="mt-4 flex gap-3">
          <input
            type="checkbox"
            checked={values.subtitles_enabled}
            onChange={(event) => setValues({ ...values, subtitles_enabled: event.target.checked })}
          />{" "}
          Enable subtitles
        </label>
        <label className="mt-3 flex gap-3">
          <input
            type="checkbox"
            checked={values.ai_enabled}
            onChange={(event) => setValues({ ...values, ai_enabled: event.target.checked })}
          />{" "}
          Enable Ask Zivora
        </label>
        <label className="mt-3 flex gap-3">
          <input
            type="checkbox"
            checked={values.voice_enabled}
            onChange={(event) => setValues({ ...values, voice_enabled: event.target.checked })}
          />{" "}
          Enable voice interaction
        </label>
        <input
          value={values.preferred_subtitle_language}
          onChange={(event) =>
            setValues({ ...values, preferred_subtitle_language: event.target.value })
          }
          placeholder="Preferred subtitle language"
          className="mt-4 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2"
        />
      </section>
      <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
        <h2 className="text-xl font-semibold">Service health</h2>
        <p className="mt-2 text-sm text-slate-400">
          Current optional-feature degradation level:{" "}
          <span className="font-semibold text-slate-200">Level {level}</span>. Playback remains
          available at every level.
        </p>
      </section>
      <button
        type="button"
        onClick={() => void save()}
        className="rounded-lg bg-violet-300 px-5 py-3 font-semibold text-slate-950"
      >
        Save preferences
      </button>
      {message && (
        <p role="status" className="text-sm text-slate-300">
          {message}
        </p>
      )}
    </div>
  );
}
