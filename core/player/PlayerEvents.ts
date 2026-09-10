import type { PlaybackError } from "./PlayerErrors";
import type { AudioTrack, Quality, TextTrack } from "@/core/adapters/PlaybackAdapter";
export type { BufferedRange } from "@/core/adapters/PlaybackAdapter";

export interface PlayerEventMap {
  ready: { duration: number; position: number };
  manifestloaded: { manifestUrl: string };
  playing: undefined;
  paused: undefined;
  timeupdate: { position: number; duration: number };
  seeking: { position: number };
  seeked: { position: number };
  bufferingstart: undefined;
  bufferingend: undefined;
  qualitychange: { quality: Quality | null; automatic: boolean };
  audiochange: { track: AudioTrack | null };
  textchange: { track: TextTrack | null };
  ratechange: { rate: number };
  volumechange: { volume: number; muted: boolean };
  error: PlaybackError;
  ended: undefined;
  destroyed: undefined;
}

export type PlayerEventName = keyof PlayerEventMap;
export type PlayerEventListener<K extends PlayerEventName> = (
  payload: PlayerEventMap[K],
) => void | Promise<void>;
export type PlayerEvent = {
  [K in PlayerEventName]: { type: K; payload: PlayerEventMap[K] };
}[PlayerEventName];

/** Observers (including optional analytics) cannot interrupt playback or another observer. */
export class TypedEventEmitter<Events extends object = PlayerEventMap> {
  private listeners: { [K in keyof Events]?: Set<(payload: Events[K]) => void | Promise<void>> } =
    {};

  on<K extends keyof Events>(
    type: K,
    listener: (payload: Events[K]) => void | Promise<void>,
  ): () => void {
    const listeners = (this.listeners[type] ??= new Set());
    listeners.add(listener);
    return () => this.off(type, listener);
  }

  off<K extends keyof Events>(
    type: K,
    listener: (payload: Events[K]) => void | Promise<void>,
  ): void {
    this.listeners[type]?.delete(listener);
  }

  emit<K extends keyof Events>(type: K, payload: Events[K]): void {
    for (const listener of [...(this.listeners[type] ?? [])]) {
      try {
        void Promise.resolve(listener(payload)).catch(() => {});
      } catch {
        /* Listener failures are isolated from the playback path. */
      }
    }
  }

  clear(): void {
    this.listeners = {};
  }
}
