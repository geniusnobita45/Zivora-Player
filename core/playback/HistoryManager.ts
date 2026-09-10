import { z } from "zod";
import { ProgressRecordSchema, progressKey } from "@/types/progress";
import type { LocalStoragePort } from "./BookmarkManager";
import { PlaybackHealth } from "./PlaybackHealth";
const HistorySchema = z.object({ progress: ProgressRecordSchema, completed: z.boolean() });
export type HistoryEntry = z.infer<typeof HistorySchema>;
export class HistoryManager {
  private values = new Map<string, HistoryEntry>();
  private key: string;
  constructor(
    private userId: string | null,
    private storage: LocalStoragePort | null,
    readonly health = new PlaybackHealth(),
  ) {
    this.key = `zivora:history:v1:${userId ?? "guest"}`;
    try {
      const raw = storage?.getItem(this.key);
      if (raw)
        for (const entry of z.array(HistorySchema).max(1000).parse(JSON.parse(raw))) {
          if (entry.progress.userId === userId)
            this.values.set(progressKey(entry.progress, userId), entry);
        }
    } catch {
      health.report("history", "storage");
    }
  }
  record(input: unknown): boolean {
    const parsed = ProgressRecordSchema.safeParse(input);
    if (!parsed.success || parsed.data.userId !== this.userId) {
      this.health.report("history", "invalid");
      return false;
    }
    const progress = parsed.data,
      key = progressKey(progress, this.userId),
      previous = this.values.get(key);
    const latest =
      previous && Date.parse(previous.progress.updatedAt) >= Date.parse(progress.updatedAt)
        ? previous.progress
        : progress;
    this.values.set(key, {
      progress: latest,
      completed:
        !!previous?.completed ||
        progress.position >= progress.duration - Math.min(10, progress.duration * 0.05),
    });
    const entries = this.list().slice(0, 1000);
    this.values = new Map(entries.map((e) => [progressKey(e.progress, this.userId), e]));
    try {
      this.storage?.setItem(this.key, JSON.stringify(entries));
    } catch {
      this.health.report("history", "storage");
    }
    return true;
  }
  list(): HistoryEntry[] {
    return [...this.values.values()].sort(
      (a, b) => Date.parse(b.progress.updatedAt) - Date.parse(a.progress.updatedAt),
    );
  }
}
