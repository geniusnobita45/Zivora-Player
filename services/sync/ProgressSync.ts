import {
  ProgressRecordSchema,
  mergeProgress,
  type ProgressRecord,
  type PlaybackTarget,
} from "@/types/progress";
import { OfflineProgress } from "./OfflineProgress";
export interface ProgressTransport {
  push(value: ProgressRecord): Promise<unknown>;
  pull(target: PlaybackTarget): Promise<unknown>;
}
export const progressTransport: ProgressTransport = {
  async push(value) {
    const response = await fetch("/api/progress", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(value),
      credentials: "same-origin",
      keepalive: true,
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error("Progress sync unavailable");
    return (await response.json()).progress;
  },
  async pull(target) {
    const query = new URLSearchParams({
      contentId: target.contentId,
      ...(target.episodeId ? { episodeId: target.episodeId } : {}),
    });
    const response = await fetch(`/api/progress?${query}`, {
      credentials: "same-origin",
      cache: "no-store",
      signal: AbortSignal.timeout(1500),
    });
    if (!response.ok) throw new Error("Progress lookup unavailable");
    return (await response.json()).progress;
  },
};
export class ProgressSync {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private attempt = 0;
  private running: Promise<void> | null = null;
  private disposed = false;
  private events: EventTarget | null;
  readonly health;
  constructor(
    readonly local: OfflineProgress,
    private transport: ProgressTransport = progressTransport,
    private online: () => boolean = () => typeof navigator === "undefined" || navigator.onLine,
    events: EventTarget | null = typeof window === "undefined" ? null : window,
    private debounceMs = 750,
  ) {
    this.health = local.health;
    this.events = events;
    events?.addEventListener("online", this.onOnline);
    this.schedule(this.debounceMs);
  }
  private onOnline = () => {
    this.attempt = 0;
    this.cancelTimer();
    void this.flush();
  };
  private cancelTimer() {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
  private schedule(delay: number) {
    if (this.disposed || !this.local.userId || this.timer !== null) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, delay);
  }
  async save(input: unknown, immediate = false): Promise<void> {
    try {
      await this.local.save(input);
      if (immediate) {
        this.cancelTimer();
        await this.flush();
      } else this.schedule(this.debounceMs);
    } catch {
      this.health.report("sync", "storage");
    }
  }
  async restore(target: PlaybackTarget): Promise<ProgressRecord | null> {
    const local = await this.local.get(target);
    if (!this.local.userId || !this.online()) return local;
    try {
      const remote = ProgressRecordSchema.nullable().parse(await this.transport.pull(target));
      if (!remote) return local;
      if (
        remote.userId !== this.local.userId ||
        remote.contentId !== target.contentId ||
        remote.episodeId !== target.episodeId
      )
        throw new Error("Wrong identity");
      const merged = mergeProgress(remote, local ?? remote);
      await this.local.save(merged);
      await this.local.acknowledge(merged, remote);
      this.schedule(this.debounceMs);
      return merged;
    } catch {
      this.health.report("sync", "network");
      return local;
    }
  }
  flush(): Promise<void> {
    if (this.running) return this.running;
    if (this.disposed || !this.local.userId || !this.online()) return Promise.resolve();
    this.cancelTimer();
    this.running = this.drain().finally(() => {
      this.running = null;
    });
    return this.running;
  }
  private async drain() {
    let failed = false;
    try {
      for (const value of await this.local.all()) {
        if (this.disposed || !this.online()) break;
        try {
          const remote = ProgressRecordSchema.parse(await this.transport.push(value));
          if (
            remote.userId !== this.local.userId ||
            remote.contentId !== value.contentId ||
            remote.episodeId !== value.episodeId
          )
            throw new Error("Wrong identity");
          if (!(await this.local.acknowledge(value, remote))) {
            failed = true;
            break;
          }
        } catch {
          failed = true;
          this.health.report("sync", "network");
          break;
        }
      }
      this.attempt = failed ? this.attempt + 1 : 0;
      if ((await this.local.all()).length)
        this.schedule(
          failed ? Math.min(60000, 1000 * 2 ** Math.min(6, this.attempt - 1)) : this.debounceMs,
        );
    } catch {
      this.health.report("sync", "storage");
      this.schedule(1000);
    }
  }
  dispose() {
    this.disposed = true;
    this.cancelTimer();
    this.events?.removeEventListener("online", this.onOnline);
    this.events = null;
  }
}
