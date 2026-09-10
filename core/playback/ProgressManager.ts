import { z } from "zod";
import { PlaybackHealth } from "./PlaybackHealth";
export const ProgressSchema = z
  .object({
    contentId: z.string().min(1).max(256),
    position: z.number().finite().nonnegative(),
    duration: z.number().finite().nonnegative(),
    updatedAt: z.string().datetime(),
    furthestPosition: z.number().finite().nonnegative().max(86400).optional(),
  })
  .strict()
  .refine((value) => value.duration === 0 || value.position <= value.duration);
export type Progress = z.infer<typeof ProgressSchema>;
interface ProgressStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
function browserStorage(): ProgressStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}
export class ProgressManager {
  private readonly memory = new Map<string, Progress>();
  constructor(
    private readonly storage: ProgressStorage | null = browserStorage(),
    private readonly userId: string | null = null,
    readonly health = new PlaybackHealth(),
  ) {}
  private key(contentId: string) {
    return this.userId
      ? `zivora:progress:user:${this.userId}:${contentId}`
      : `zivora:progress:${contentId}`;
  }
  save(input: unknown): boolean {
    const parsed = ProgressSchema.safeParse(input);
    if (!parsed.success) {
      this.health.report("progress", "invalid");
      return false;
    }
    const old = this.load(parsed.data.contentId);
    const latest =
      old && Date.parse(old.updatedAt) >= Date.parse(parsed.data.updatedAt) ? old : parsed.data;
    const progress = {
      ...latest,
      furthestPosition: Math.max(
        old?.furthestPosition ?? old?.position ?? 0,
        parsed.data.furthestPosition ?? parsed.data.position,
        parsed.data.position,
      ),
    };
    this.memory.set(progress.contentId, progress);
    try {
      this.storage?.setItem(this.key(progress.contentId), JSON.stringify(progress));
    } catch {
      this.health.report("progress", "storage");
    }
    return true;
  }
  load(contentId: string): Progress | null {
    if (!z.string().min(1).max(256).safeParse(contentId).success) return null;
    const memory = this.memory.get(contentId);
    try {
      const value = this.storage?.getItem(this.key(contentId));
      if (value) {
        const parsed = ProgressSchema.safeParse(JSON.parse(value));
        if (parsed.success && parsed.data.contentId === contentId) {
          const latest =
            !memory || Date.parse(parsed.data.updatedAt) > Date.parse(memory.updatedAt)
              ? parsed.data
              : memory;
          const merged = {
            ...latest,
            furthestPosition: Math.max(
              memory?.furthestPosition ?? memory?.position ?? 0,
              parsed.data.furthestPosition ?? parsed.data.position,
            ),
          };
          this.memory.set(contentId, merged);
          return merged;
        }
      }
    } catch {
      this.health.report("progress", "storage");
    }
    return memory ?? null;
  }
}
