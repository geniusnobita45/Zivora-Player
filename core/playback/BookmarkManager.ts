import { z } from "zod";
import { BookmarkSchema, type Bookmark, type PlaybackTarget } from "@/types/progress";
import { PlaybackHealth } from "./PlaybackHealth";
export interface LocalStoragePort {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
export interface BookmarkRemote {
  list(target: PlaybackTarget): Promise<unknown>;
  put(value: Bookmark): Promise<unknown>;
}
const JournalSchema = z.object({
  values: z.array(BookmarkSchema).max(10000),
  pending: z.array(z.string().uuid()).max(10000),
});
export class BookmarkManager {
  private values = new Map<string, Bookmark>();
  private pending = new Set<string>();
  private listeners = new Set<() => void>();
  private revision = 0;
  private running: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private attempt = 0;
  private disposed = false;
  private key: string;
  constructor(
    readonly userId: string | null,
    private storage: LocalStoragePort | null,
    private remote?: BookmarkRemote,
    readonly health = new PlaybackHealth(),
  ) {
    this.key = `zivora:bookmarks:v1:${userId ?? "guest"}`;
    try {
      const raw = storage?.getItem(this.key);
      if (raw) {
        const journal = JournalSchema.parse(JSON.parse(raw));
        journal.values.forEach((value) => {
          if (value.userId === userId) this.values.set(value.id, value);
        });
        journal.pending.forEach((id) => {
          if (this.values.has(id)) this.pending.add(id);
        });
      }
    } catch {
      health.report("bookmarks", "storage");
    }
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getRevision = () => this.revision;
  list(target: PlaybackTarget) {
    return [...this.values.values()]
      .filter(
        (v) => !v.deleted && v.contentId === target.contentId && v.episodeId === target.episodeId,
      )
      .sort((a, b) => a.position - b.position);
  }
  private changed() {
    try {
      this.storage?.setItem(
        this.key,
        JSON.stringify({ values: [...this.values.values()], pending: [...this.pending] }),
      );
    } catch {
      this.health.report("bookmarks", "storage");
    }
    this.revision++;
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        /* isolated view */
      }
    }
  }
  save(input: unknown): boolean {
    const parsed = BookmarkSchema.safeParse(input);
    if (!parsed.success || parsed.data.userId !== this.userId) {
      this.health.report("bookmarks", "invalid");
      return false;
    }
    const value = parsed.data,
      old = this.values.get(value.id);
    if (old && (old.contentId !== value.contentId || old.episodeId !== value.episodeId))
      return false;
    if (this.values.size >= 10000 && !old) {
      this.health.report("bookmarks", "storage");
      return false;
    }
    if (old && Date.parse(old.updatedAt) >= Date.parse(value.updatedAt)) return true;
    this.values.set(value.id, value);
    if (this.userId) this.pending.add(value.id);
    this.changed();
    this.schedule(750);
    return true;
  }
  remove(id: string): boolean {
    const old = this.values.get(id);
    if (!old) return false;
    return this.save({
      ...old,
      deleted: true,
      updatedAt: new Date(Math.max(Date.now(), Date.parse(old.updatedAt) + 1)).toISOString(),
    });
  }
  async refresh(target: PlaybackTarget) {
    if (!this.userId || !this.remote) return;
    try {
      const records = z
        .array(BookmarkSchema)
        .max(10000)
        .parse(await this.remote.list(target));
      if (
        records.some(
          (v) =>
            v.userId !== this.userId ||
            v.contentId !== target.contentId ||
            v.episodeId !== target.episodeId,
        )
      )
        throw new Error("Wrong bookmark scope");
      for (const value of records) {
        const old = this.values.get(value.id);
        if (!old || Date.parse(value.updatedAt) > Date.parse(old.updatedAt)) {
          this.values.set(value.id, value);
          this.pending.delete(value.id);
        }
      }
      this.changed();
      void this.flush();
    } catch {
      this.health.report("bookmarks", "network");
    }
  }
  private schedule(delay: number) {
    if (this.disposed || !this.userId || !this.remote || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, delay);
  }
  flush(): Promise<void> {
    if (this.running) return this.running;
    if (this.disposed || !this.userId || !this.remote) return Promise.resolve();
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.running = (async () => {
      try {
        for (const id of [...this.pending]) {
          if (this.disposed) break;
          const sent = this.values.get(id)!;
          const value = BookmarkSchema.parse(await this.remote!.put(sent));
          if (
            value.userId !== this.userId ||
            value.id !== id ||
            value.contentId !== sent.contentId ||
            value.episodeId !== sent.episodeId
          )
            throw new Error("Wrong bookmark response");
          const latest = this.values.get(id)!;
          if (Date.parse(value.updatedAt) >= Date.parse(latest.updatedAt)) {
            this.values.set(id, value);
            this.pending.delete(id);
          }
          this.changed();
        }
        this.attempt = 0;
      } catch {
        this.attempt++;
        this.health.report("bookmarks", "network");
      }
      if (this.pending.size) this.schedule(Math.min(60000, 1000 * 2 ** Math.min(this.attempt, 6)));
    })().finally(() => {
      this.running = null;
    });
    return this.running;
  }
  dispose() {
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
