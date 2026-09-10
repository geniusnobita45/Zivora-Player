import { z } from "zod";
import {
  computeWatchBoundary,
  WatchBoundarySchema,
  withinBoundary,
  type WatchBoundary,
} from "./WatchBoundary";
const IntervalSchema = z
  .object({
    episode_order: z.number().int().nonnegative(),
    start_s: z.number().finite().nonnegative(),
    end_s: z.number().finite().max(86400),
  })
  .refine((v) => v.end_s > v.start_s);
export class SpoilerGuard {
  boundary(state: unknown, mode: unknown): WatchBoundary {
    return computeWatchBoundary(state, mode);
  }
  /** SQL is the primary boundary; a broken RPC fails closed before context assembly. */
  assertSafe<T extends { episode_order: number; start_s: number; end_s: number }>(
    rows: readonly T[],
    boundaryInput: WatchBoundary,
  ): T[] {
    const boundary = WatchBoundarySchema.parse(boundaryInput);
    for (const row of rows) {
      const interval = IntervalSchema.parse(row);
      if (!withinBoundary(interval.episode_order, interval.end_s, boundary))
        throw new Error("Retrieval crossed the spoiler boundary");
    }
    return [...rows];
  }
}
