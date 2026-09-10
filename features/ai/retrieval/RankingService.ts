import { z } from "zod";
import { SearchResultSchema, type SearchResult } from "./types";
const BoostsSchema = z
  .object({
    characterId: z.string().uuid().optional(),
    chapterId: z.string().uuid().optional(),
  })
  .strict();
export type RankedResult = SearchResult & { score: number };
export class RankingService {
  rank(input: unknown, boostsInput: z.input<typeof BoostsSchema> = {}): RankedResult[] {
    const rows = z.array(SearchResultSchema).max(60).parse(input);
    const boosts = BoostsSchema.parse(boostsInput);
    const unique = new Map<string, RankedResult>();
    for (const row of rows) {
      const multiplier =
        1 +
        (boosts.characterId && row.character_ids.includes(boosts.characterId) ? 0.12 : 0) +
        (boosts.chapterId === row.chapter_id ? 0.08 : 0);
      const ranked = { ...row, score: row.fused_score * multiplier };
      const key = row.kind + ":" + row.id;
      if (!unique.has(key) || unique.get(key)!.score < ranked.score) unique.set(key, ranked);
    }
    return [...unique.values()].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  }
}
