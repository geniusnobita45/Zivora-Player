import { AIRequestSchema, type AuthorizedContext } from "@/features/ai/orchestrator/contracts";
import type { RankedResult } from "@/features/ai/retrieval/RankingService";
export const uid = (n: number) => "00000000-0000-4000-8000-" + String(n).padStart(12, "0");
export const request = AIRequestSchema.parse({
  contentId: uid(1),
  question: "find the lighthouse scene",
  language: "en",
  watchState: {
    currentEpisodeOrder: 0,
    currentPosition: 30,
    furthestEpisodeOrder: 0,
    furthestPosition: 60,
  },
});
export const authorization: AuthorizedContext = {
  userId: uid(2),
  duration: 100,
  mediaVersionIds: [uid(3)],
  modelVersion: "fixture-v1",
};
export function scene(overrides: Partial<RankedResult> = {}): RankedResult {
  return {
    id: uid(4),
    kind: "scene",
    content_id: uid(1),
    episode_id: null,
    media_version_id: uid(3),
    episode_order: 0,
    start_s: 10,
    end_s: 20,
    title: "Lighthouse",
    text: "They arrive at the lighthouse.",
    character_ids: [],
    chapter_id: null,
    chapter_title: null,
    fused_score: 2 / 61,
    score: 2 / 61,
    vector_score: 0.99,
    keyword_score: 1,
    ...overrides,
  };
}
