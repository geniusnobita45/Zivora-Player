import { SearchRequestSchema, type SearchRequest } from "./types";
import { KeywordSearch } from "./KeywordSearch";
import { VectorSearch } from "./VectorSearch";
import { RankingService } from "./RankingService";
export class HybridRetriever {
  constructor(
    private readonly keyword: KeywordSearch,
    private readonly vector?: VectorSearch,
    private readonly ranking = new RankingService(),
  ) {}
  async retrieve(input: SearchRequest, signal?: AbortSignal) {
    const request = SearchRequestSchema.parse(input);
    let embedding: number[] | null = null;
    if (this.vector) {
      try {
        embedding = await this.vector.embed(request.query, signal);
      } catch (error) {
        if (signal?.aborted) throw error;
      }
    }
    const rows = await this.keyword.search(
      {
        ...request,
        filters: {
          ...request.filters,
          ...(embedding && this.vector ? { embedding_model: this.vector.model } : {}),
        },
      },
      embedding,
      signal,
    );
    return this.ranking
      .rank(rows, {
        characterId: request.filters.character_id,
        chapterId: request.filters.chapter_id,
      })
      .slice(0, request.limit);
  }
}
