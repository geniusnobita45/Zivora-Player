import { createHash } from "node:crypto";
import { z } from "zod";
import {
  AIAnswerSchema,
  type AIRequest,
  type AuthorizedContext,
  type AIIntent,
} from "../orchestrator/contracts";
import { RetrievalPolicy } from "../spoiler-guard/RetrievalPolicy";
import { WatchBoundarySchema, type WatchBoundary } from "../spoiler-guard/WatchBoundary";
export function normalizeQuestion(input: unknown): string {
  return z
    .string()
    .min(1)
    .max(2000)
    .parse(input)
    .normalize("NFKC")
    .trim()
    .replace(/\s+/gu, " ")
    .toLowerCase();
}
export function cacheKey(
  request: AIRequest,
  context: AuthorizedContext,
  intent: AIIntent,
  boundary: WatchBoundary,
): string {
  const safe = WatchBoundarySchema.parse(boundary);
  return createHash("sha256")
    .update(
      JSON.stringify({
        contentId: request.contentId,
        episodeId: request.episodeId,
        timeBucket: Math.floor(request.watchState.currentPosition / 30),
        intent,
        normalizedQuestion: normalizeQuestion(request.question),
        language: request.language.toLowerCase(),
        spoilerBoundaryBucket: [
          safe.boundary_episode_order,
          Math.floor(safe.boundary_seconds / 30),
        ],
        exactBoundary: safe,
        mode: request.mode,
        filters: request.filters,
        userId: context.userId,
        mediaVersions: [...context.mediaVersionIds].sort(),
        modelVersion: context.modelVersion,
        policy: RetrievalPolicy.version,
      }),
    )
    .digest("hex");
}
export const CachedAnswerSchema = AIAnswerSchema.omit({ command: true });
export interface AICacheStore {
  get(key: string, userId: string): Promise<unknown | null>;
  put(
    key: string,
    userId: string,
    answer: z.infer<typeof CachedAnswerSchema>,
    expiresAt: string,
  ): Promise<void>;
}
async function cacheDeadline<T>(operation: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Cache timeout")), 500);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
export class AICache {
  constructor(
    private readonly store: AICacheStore,
    private readonly now: () => number = Date.now,
  ) {}
  async get(key: string, userId: string) {
    try {
      const value = await cacheDeadline(() => this.store.get(key, userId));
      return value === null ? null : CachedAnswerSchema.parse(value);
    } catch {
      return null;
    }
  }
  async put(key: string, userId: string, answer: unknown, ttlSeconds = 300) {
    const ttl = z.number().int().min(1).max(3600).parse(ttlSeconds);
    const parsed = CachedAnswerSchema.parse(answer);
    try {
      await cacheDeadline(() =>
        this.store.put(key, userId, parsed, new Date(this.now() + ttl * 1000).toISOString()),
      );
    } catch {
      /* Optional caching never changes the answer. */
    }
  }
}
