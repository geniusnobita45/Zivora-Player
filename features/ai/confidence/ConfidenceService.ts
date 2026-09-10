import { z } from "zod";
import { RetrievalPolicy } from "../spoiler-guard/RetrievalPolicy";
const ScoreSchema = z.number().finite().nonnegative();
/** Conservative ranking heuristic, not a calibrated probability of factual correctness. */
export function retrievalConfidence(topInput: number, runnerUpInput = 0): number {
  const top = ScoreSchema.parse(topInput),
    runner = ScoreSchema.parse(runnerUpInput);
  if (!top) return 0;
  const strength = Math.min(1, top / (2 / (RetrievalPolicy.rrfK + 1)));
  const margin = Math.max(0, Math.min(1, (top - runner) / top));
  return Math.min(1, Math.max(0, strength * (0.55 + 0.45 * margin)));
}
