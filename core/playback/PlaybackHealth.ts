export interface PlaybackHealthEvent {
  component: "progress" | "sync" | "bookmarks" | "history";
  code: "invalid" | "storage" | "network" | "identity";
  at: number;
}
/** Optional health subscribers may fail without propagating into playback. No payloads/secrets. */
export class PlaybackHealth {
  private listeners = new Set<(event: PlaybackHealthEvent) => void>();
  report(component: PlaybackHealthEvent["component"], code: PlaybackHealthEvent["code"]) {
    const event = { component, code, at: Date.now() };
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        /* isolated observer */
      }
    }
  }
  on(listener: (event: PlaybackHealthEvent) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
