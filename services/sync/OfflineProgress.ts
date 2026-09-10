import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import { z } from "zod";
import { PlaybackHealth } from "@/core/playback/PlaybackHealth";
import {
  ProgressRecordSchema,
  mergeProgress,
  progressKey,
  type PlaybackTarget,
  type ProgressRecord,
} from "@/types/progress";

const EntrySchema = z.object({
  key: z.string(),
  value: ProgressRecordSchema,
  pending: z.boolean(),
});
type Entry = z.infer<typeof EntrySchema>;
interface ProgressDB extends DBSchema {
  checkpoints: { key: string; value: Entry };
}
export class OfflineProgress {
  private memory = new Map<string, Entry>();
  private database: Promise<IDBPDatabase<ProgressDB>> | null = null;
  private writes: Promise<unknown> = Promise.resolve();
  constructor(
    readonly userId: string | null,
    readonly health = new PlaybackHealth(),
    private name = "zivora-playback-v1",
  ) {}
  private db() {
    if (!this.database)
      this.database = openDB<ProgressDB>(this.name, 1, {
        upgrade(db) {
          db.createObjectStore("checkpoints", { keyPath: "key" });
        },
        blocked: () => this.health.report("progress", "storage"),
        blocking: () => {
          void this.close();
        },
        terminated: () => {
          this.database = null;
          this.health.report("progress", "storage");
        },
      }).catch((error) => {
        this.database = null;
        throw error;
      });
    return this.database;
  }
  private entry(input: unknown): Entry {
    const entry = EntrySchema.parse(input);
    if (entry.value.userId !== this.userId || entry.key !== progressKey(entry.value, this.userId))
      throw new Error("Progress identity mismatch");
    return entry;
  }
  async save(input: unknown): Promise<ProgressRecord | null> {
    let value: ProgressRecord;
    try {
      value = ProgressRecordSchema.parse(input);
      if (value.userId !== this.userId) throw new Error("Wrong user");
    } catch {
      this.health.report("progress", "invalid");
      return null;
    }
    const key = progressKey(value, this.userId);
    const entry = {
      key,
      value: mergeProgress(this.memory.get(key)?.value ?? null, value),
      pending: this.userId !== null,
    };
    this.memory.set(key, entry);
    const task = this.writes.then(async () => {
      try {
        const tx = (await this.db()).transaction("checkpoints", "readwrite");
        const previous = await tx.store.get(key);
        const merged = mergeProgress(previous ? this.entry(previous).value : null, entry.value);
        await tx.store.put({ ...entry, value: merged });
        await tx.done;
        const current = this.memory.get(key)!;
        this.memory.set(key, { ...current, value: mergeProgress(merged, current.value) });
      } catch {
        this.health.report("progress", "storage");
      }
    });
    this.writes = task;
    await task;
    return this.memory.get(key)!.value;
  }
  async get(target: PlaybackTarget): Promise<ProgressRecord | null> {
    const key = progressKey(target, this.userId);
    await this.writes;
    try {
      const stored = await (await this.db()).get("checkpoints", key);
      if (stored) {
        const entry = this.entry(stored),
          local = this.memory.get(key);
        this.memory.set(key, {
          ...entry,
          value: mergeProgress(entry.value, local?.value ?? entry.value),
          pending: entry.pending || !!local?.pending,
        });
      }
    } catch {
      this.health.report("progress", "storage");
    }
    return this.memory.get(key)?.value ?? null;
  }
  async all(): Promise<ProgressRecord[]> {
    await this.writes;
    try {
      for (const raw of await (await this.db()).getAll("checkpoints")) {
        if (raw.value.userId !== this.userId) continue;
        const entry = this.entry(raw),
          local = this.memory.get(entry.key);
        this.memory.set(entry.key, {
          ...entry,
          value: mergeProgress(entry.value, local?.value ?? entry.value),
          pending: entry.pending || !!local?.pending,
        });
      }
    } catch {
      this.health.report("progress", "storage");
    }
    return [...this.memory.values()].filter((e) => e.pending).map((e) => e.value);
  }
  async acknowledge(sent: ProgressRecord, response: unknown): Promise<boolean> {
    try {
      const remote = ProgressRecordSchema.parse(response);
      if (
        progressKey(remote, remote.userId) !== progressKey(sent, this.userId) ||
        remote.userId !== this.userId
      )
        throw new Error("Wrong acknowledgement");
      const key = progressKey(sent, this.userId);
      const task = this.writes.then(async () => {
        const merge = (current: Entry | undefined): Entry => {
          const value = mergeProgress(remote, current?.value ?? sent);
          return { key, value, pending: JSON.stringify(value) !== JSON.stringify(remote) };
        };
        try {
          const tx = (await this.db()).transaction("checkpoints", "readwrite");
          const stored = await tx.store.get(key),
            current = stored ? this.entry(stored) : undefined;
          const local = this.memory.get(key);
          const entry = merge(
            local
              ? { ...local, value: mergeProgress(current?.value ?? null, local.value) }
              : current,
          );
          await tx.store.put(entry);
          await tx.done;
          const latest = this.memory.get(key);
          this.memory.set(
            key,
            merge(latest ? { ...latest, value: mergeProgress(entry.value, latest.value) } : entry),
          );
          return true;
        } catch {
          this.health.report("progress", "storage");
          return false;
        }
      });
      this.writes = task;
      return await task;
    } catch {
      this.health.report("sync", "invalid");
      return false;
    }
  }
  async close() {
    await this.writes;
    try {
      (await this.database)?.close();
    } catch {
      /* unavailable database */
    }
    this.database = null;
  }
}
