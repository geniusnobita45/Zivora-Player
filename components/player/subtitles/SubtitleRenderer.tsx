"use client";
import { Component, useEffect, type ReactNode } from "react";
import { useStore } from "zustand";
import type { SubtitleStore } from "@/stores/subtitle.store";
import { usePlayerStore } from "../PlayerContext";
import type { DegradationManager } from "@/services/degradation/DegradationManager";

class SubtitleBoundary extends Component<
  { store: SubtitleStore; manager?: DegradationManager; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.store.setState({ healthy: false });
    this.props.manager?.reportUnavailable("subtitles", () => true);
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

function Captions({ store }: { store: SubtitleStore }) {
  const cues = useStore(store, (s) => s.cues);
  const visible = useStore(store, (s) => s.visible);
  const preferences = useStore(store, (s) => s.preferences);
  const controls = usePlayerStore((s) => s.ui.controlsVisible || (s.snapshot?.paused ?? true));
  useEffect(() => {
    store.setState({ healthy: true });
    return () => {
      store.setState({ healthy: false });
    };
  }, [store]);
  if (!visible || !cues.length) return null;
  return (
    <div
      className="zivora-custom-subtitles"
      data-size={preferences.size}
      data-position={preferences.position}
      data-controls={controls}
      aria-label="Captions"
      dir="auto"
    >
      {cues.map((cue, i) => (
        <div className="zivora-custom-cue" key={`${cue.id}:${cue.start}:${i}`}>
          <span>
            {preferences.speakerNames && cue.speaker && <strong>{cue.speaker}: </strong>}
            {cue.text}
          </span>
          {preferences.contextHints && cue.hint && <small>{cue.hint}</small>}
        </div>
      ))}
    </div>
  );
}
export function SubtitleRenderer({
  store,
  manager,
}: {
  store: SubtitleStore;
  manager?: DegradationManager;
}) {
  return (
    <SubtitleBoundary store={store} manager={manager}>
      <Captions store={store} />
    </SubtitleBoundary>
  );
}
