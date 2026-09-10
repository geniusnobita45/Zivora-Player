// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { HybridRetriever } from "@/features/ai/retrieval/HybridRetriever";
import { KeywordSearch } from "@/features/ai/retrieval/KeywordSearch";
import { VectorSearch } from "@/features/ai/retrieval/VectorSearch";
import { MockProvider } from "@/features/ai/gateway/MockProvider";
import { request, scene } from "./fixtures";
const input = {
  contentId: request.contentId,
  query: "lighthouse",
  boundary: { boundary_episode_order: 0, boundary_seconds: 30 },
};
const row = () => {
  const { score, ...value } = scene();
  void score;
  return value;
};
describe("hybrid retrieval", () => {
  it("passes the same boundary to both SQL searches and falls back to keywords if embedding fails", async () => {
    const rpc = vi.fn(async (name: string, args: unknown) => {
      void args;
      return name === "search_scenes" ? [row()] : [];
    });
    const vector = new VectorSearch(
      new MockProvider("bad", "model", {
        embed: () => {
          throw new Error("offline");
        },
      }),
    );
    const results = await new HybridRetriever(new KeywordSearch(rpc), vector).retrieve(input);
    expect(results).toHaveLength(1);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls[0][1]).toMatchObject({
      query_embedding: null,
      boundary_seconds: 30,
      boundary_episode_order: 0,
    });
  });
  it("refuses out-of-boundary, cross-content, and malformed RPC rows", async () => {
    for (const bad of [
      { ...row(), end_s: 31 },
      { ...row(), content_id: "00000000-0000-4000-8000-000000000099" },
      { bad: true },
    ])
      await expect(new KeywordSearch(async () => [bad]).search(input)).rejects.toThrow();
  });
});
