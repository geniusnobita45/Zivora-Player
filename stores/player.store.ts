import { createStore } from "zustand/vanilla";
import type { PlayerController } from "@/core/player/PlayerController";
import type { PlayerSnapshot } from "@/core/player/PlayerEngine";
import type { AudioTrack, Quality, TextTrack } from "@/core/adapters/PlaybackAdapter";
import type { BufferSnapshot } from "@/core/streaming/BufferMonitor";
import type { PlayerEventName } from "@/core/player/PlayerEvents";

export interface PlayerUI {
  controlsVisible: boolean;
  activity: number;
  focused: boolean;
  menu: "settings" | null;
  phase: "authorizing" | "loading" | "ready" | "failed";
  loadError: string | null;
  notice: string | null;
  gesture: string | null;
  resumePosition: number | null;
  captionSize: "normal" | "large";
  fullscreen: boolean;
  pip: boolean;
}
export interface PlayerStoreState {
  bufferedRanges: { start: number; end: number }[];
  snapshot: Readonly<PlayerSnapshot> | null;
  qualities: Quality[];
  audioTracks: AudioTrack[];
  textTracks: TextTrack[];
  buffer: BufferSnapshot | null;
  ui: PlayerUI;
}
export function createPlayerStore() {
  return createStore<PlayerStoreState>(() => ({
    bufferedRanges: [],
    snapshot: null,
    qualities: [],
    audioTracks: [],
    textTracks: [],
    buffer: null,
    ui: {
      controlsVisible: true,
      activity: 0,
      focused: false,
      menu: null,
      phase: "authorizing",
      loadError: null,
      notice: null,
      gesture: null,
      resumePosition: null,
      captionSize: "normal",
      fullscreen: false,
      pip: false,
    },
  }));
}
export type PlayerStore = ReturnType<typeof createPlayerStore>;
export function updatePlayerUI(store: PlayerStore, patch: Partial<PlayerUI>): void {
  store.setState((state) => ({ ui: { ...state.ui, ...patch } }));
}
export function revealControls(store: PlayerStore): void {
  const { ui } = store.getState();
  updatePlayerUI(store, { controlsVisible: true, activity: ui.activity + 1 });
}
export function canHideControls(state: PlayerStoreState): boolean {
  return (
    !!state.snapshot &&
    !state.snapshot.paused &&
    state.snapshot.state === "playing" &&
    !state.ui.focused &&
    !state.ui.menu &&
    state.ui.resumePosition === null &&
    !state.ui.loadError &&
    state.ui.phase === "ready"
  );
}
export function refreshPlayerStore(store: PlayerStore, controller: PlayerController): void {
  const streaming = controller.getStreamingSnapshot();
  store.setState({
    snapshot: controller.getSnapshot(),
    qualities: streaming.quality.renditions,
    audioTracks: streaming.tracks.audio,
    textTracks: streaming.tracks.text,
    buffer: streaming.buffer,
    bufferedRanges: streaming.bufferedRanges,
  });
}
/** Engine events arrive only through the controller's read-only event facade. */
export function connectPlayerStore(store: PlayerStore, controller: PlayerController): () => void {
  const refresh = () => refreshPlayerStore(store, controller);
  const events: PlayerEventName[] = [
    "ready",
    "manifestloaded",
    "playing",
    "paused",
    "timeupdate",
    "seeking",
    "seeked",
    "bufferingstart",
    "bufferingend",
    "qualitychange",
    "audiochange",
    "textchange",
    "ratechange",
    "volumechange",
    "error",
    "ended",
    "destroyed",
  ];
  const subscriptions = events.map((event) => controller.on(event, refresh));
  subscriptions.push(controller.on("commandaudit", refresh));
  refresh();
  const timer = setInterval(refresh, 500);
  return () => {
    clearInterval(timer);
    subscriptions.forEach((unsubscribe) => unsubscribe());
  };
}
