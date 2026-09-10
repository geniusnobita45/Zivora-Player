// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { AIOrchestrator } from "@/features/ai/orchestrator/AIOrchestrator";
import { ContextBuilder } from "@/features/ai/orchestrator/ContextBuilder";
import { IntentRouter } from "@/features/ai/orchestrator/IntentRouter";
import { MockProvider } from "@/features/ai/gateway/MockProvider";
import { AICache } from "@/features/ai/cache/AICache";
import { retrievalConfidence } from "@/features/ai/confidence/ConfidenceService";
import { RankingService } from "@/features/ai/retrieval/RankingService";
import { scene, request, authorization, uid } from "./fixtures";
function setup(output: unknown, rows = [scene()]) {
  const generate = vi.fn(() => output),
    retrieve = vi.fn(async () => rows);
  const append = vi.fn(async () => uid(20));
  const ai = new AIOrchestrator(
    new MockProvider("mock", "test", { generate }),
    { retrieve },
    new AICache({ get: async () => null, put: async () => {} }),
    { append },
    () => 1000,
  );
  return { ai, generate, retrieve, append };
}
const answer = {
  answer: "The lighthouse scene is at 10 seconds.",
  confidence: 0.95,
  candidates: [
    { timestamp: 10, label: "Lighthouse", confidence: 0.95, evidenceId: uid(4), episodeId: null },
  ],
};
describe("AI confidence and orchestration", () => {
  it("returns one validated seek for one grounded high-confidence current-episode candidate", async () => {
    const { ai, append } = setup(answer);
    const response = await ai.ask(request, authorization);
    expect(response.command).toEqual({
      type: "SEEK_TO",
      seconds: 10,
      source: "ai",
      reason: "Lighthouse",
      issuedAt: 1000,
    });
    expect(append).toHaveBeenCalledWith(
      request,
      uid(2),
      expect.objectContaining({ command: response.command }),
    );
  });
  it.each([0, 0.79])("leaves low confidence %s as candidates", async (confidence) => {
    const { ai } = setup({ ...answer, confidence });
    expect((await ai.ask(request, authorization)).command).toBeUndefined();
  });
  it("accepts exactly 0.8 and leaves multiple candidates uncommitted", async () => {
    const single = setup({ ...answer, confidence: 0.8 });
    expect((await single.ai.ask(request, authorization)).command?.type).toBe("SEEK_TO");
    const multiple = setup(
      {
        ...answer,
        candidates: [
          ...answer.candidates,
          { timestamp: 21, label: "Other", confidence: 0.95, evidenceId: uid(5), episodeId: null },
        ],
      },
      [scene(), scene({ id: uid(5), start_s: 21, end_s: 25 })],
    );
    const response = await multiple.ai.ask(request, authorization);
    expect(response.candidates).toHaveLength(2);
    expect(response.command).toBeUndefined();
  });
  it("does not let the model hide the runner-up to trigger an automatic seek", async () => {
    const { ai } = setup(answer, [
      scene(),
      scene({ id: uid(5), start_s: 21, end_s: 25, fused_score: 2 / 62 }),
    ]);
    const response = await ai.ask(request, authorization);
    expect(response.confidence).toBeLessThan(0.8);
    expect(response.command).toBeUndefined();
  });
  it("rejects invented timestamps and model-injected controls", async () => {
    const { ai } = setup({
      ...answer,
      candidates: [{ timestamp: 99, label: "Invented", confidence: 1 }],
      command: { type: "PLAY", source: "ui", issuedAt: 0 },
    });
    const response = await ai.ask(request, authorization);
    expect(response.candidates).toEqual([]);
    expect(response.command).toBeUndefined();
  });
  it("cannot assign the top result's confidence to a weaker candidate selected by the model", async () => {
    const { ai } = setup(
      {
        ...answer,
        candidates: [
          {
            timestamp: 21,
            label: "Weak match",
            confidence: 1,
            evidenceId: uid(5),
            episodeId: null,
          },
        ],
      },
      [scene(), scene({ id: uid(5), start_s: 21, end_s: 25, fused_score: 0.001, score: 0.001 })],
    );
    const response = await ai.ask(request, authorization);
    expect(response.confidence).toBeLessThan(0.8);
    expect(response.command).toBeUndefined();
  });
  it("returns no seek for a previous-episode candidate", async () => {
    const { ai } = setup(
      { ...answer, candidates: [{ ...answer.candidates[0], episodeId: uid(40) }] },
      [scene({ episode_id: uid(40) })],
    );
    const response = await ai.ask(
      {
        ...request,
        episodeId: uid(41),
        watchState: {
          currentEpisodeOrder: 1,
          currentPosition: 30,
          furthestEpisodeOrder: 1,
          furthestPosition: 30,
        },
      },
      authorization,
    );
    expect(response.candidates[0].episodeId).toBe(uid(40));
    expect(response.command).toBeUndefined();
  });
  it("abstains on empty evidence without calling the LLM", async () => {
    const { ai, generate } = setup(answer, []);
    const response = await ai.ask(request, authorization);
    expect(response.confidence).toBe(0);
    expect(generate).not.toHaveBeenCalled();
  });
  it("blocks a broken retriever before any model sees its data", async () => {
    const { ai, generate } = setup(answer, [scene({ end_s: 31, text: "Future secret" })]);
    await expect(ai.ask(request, authorization)).rejects.toThrow("spoiler boundary");
    expect(generate).not.toHaveBeenCalled();
  });
  it("handles explicit play controls without retrieval or generation", async () => {
    const { ai, retrieve, generate } = setup(answer);
    expect((await ai.ask({ ...request, question: "pause" }, authorization)).command?.type).toBe(
      "PAUSE",
    );
    expect(retrieve).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
  });
  it("computes bounded confidence and metadata ranking deterministically", () => {
    expect(retrievalConfidence(0)).toBe(0);
    expect(retrievalConfidence(2 / 61)).toBe(1);
    expect(retrievalConfidence(2 / 61, 2 / 61)).toBe(0.55);
    expect(() => retrievalConfidence(NaN)).toThrow();
    const raw = [scene(), scene({ id: uid(5), character_ids: [uid(6)] })].map(
      ({ score, ...row }) => {
        void score;
        return row;
      },
    );
    const ranked = new RankingService().rank(raw, { characterId: uid(6) });
    expect(ranked[0].id).toBe(uid(5));
  });
  it.each([
    ["who is Sam", "who_is_character"],
    ["what happened", "what_happened"],
    ["recap please", "recap"],
    ["explain the reference", "explain_reference"],
    ["pause", "control_player"],
    ["find the funny scene", "mood_search"],
    ["previously watched scenes", "previously_watched"],
    ["find the scene", "find_scene"],
    ["hello", "general"],
  ])("routes %s to %s", (question, intent) =>
    expect(new IntentRouter().route(question)).toBe(intent),
  );
  it("marks evidence as untrusted and bounds the context", () => {
    const value = new ContextBuilder().build("question", "en", "general", [scene()], {
      boundary_episode_order: 0,
      boundary_seconds: 30,
    });
    expect(value.system).toContain("untrusted data");
    expect(value.system).toContain("Do not use outside knowledge");
    expect(value.evidenceIds.has(uid(4))).toBe(true);
  });
});
