import { z } from "zod";
import { SpoilerGuard } from "../spoiler-guard/SpoilerGuard";
import {
  EmbeddingSchema,
  SearchRequestSchema,
  SearchResultSchema,
  type SearchRPC,
  type SearchRequest,
} from "./types";
export class KeywordSearch {
  constructor(private readonly rpc: SearchRPC) {}
  async search(input: SearchRequest, embedding: number[] | null = null, signal?: AbortSignal) {
    const request = SearchRequestSchema.parse(input);
    if (embedding !== null) EmbeddingSchema.parse(embedding);
    const lists = await Promise.all(
      (["search_scenes", "search_transcript"] as const).map(async (name) => {
        const rows = z
          .array(SearchResultSchema)
          .max(30)
          .parse(
            await this.rpc(
              name,
              {
                query_embedding: embedding ? JSON.stringify(embedding) : null,
                query_text: request.query,
                content_id: request.contentId,
                ...request.boundary,
                filters: request.filters,
                limit: request.limit,
              },
              signal,
            ),
          );
        if (
          rows.some(
            (row) =>
              row.content_id !== request.contentId ||
              row.kind !== (name === "search_scenes" ? "scene" : "transcript") ||
              (request.filters.episode_id && row.episode_id !== request.filters.episode_id) ||
              (request.filters.media_version_ids &&
                !request.filters.media_version_ids.includes(row.media_version_id)),
          )
        )
          throw new Error("Retrieval scope mismatch");
        return new SpoilerGuard().assertSafe(rows, request.boundary);
      }),
    );
    return lists.flat();
  }
}
