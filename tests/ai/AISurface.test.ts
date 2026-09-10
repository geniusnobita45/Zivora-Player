// @vitest-environment node
import { describe, expect, it } from "vitest";
import { sceneSearchAIRequest } from "@/features/ai/scene-search";
import { characterAIRequest } from "@/features/ai/characters";
import { dialogueAIRequest } from "@/features/ai/dialogue";
import { recapAIRequest, recapFromSegments } from "@/features/ai/recap";
import { request, uid } from "./fixtures";

describe("frozen AI feature contracts", () => {
  it("maps scene, mood, and character requests to the authorized orchestrator input", () => {
    expect(
      sceneSearchAIRequest({ ...request, query: "a tense reunion", searchMode: "mood" }).question,
    ).toContain("mood");
    const character = characterAIRequest({
      ...request,
      characterName: "Mara",
      characterId: uid(6),
    });
    expect(character.filters.character_id).toBe(uid(6));
    expect(character.question).toContain("already watched");
  });
  it("uses bounded dialogue prompts and deterministic offline recap summaries", () => {
    expect(dialogueAIRequest({ ...request, action: "reference" }).question).toContain("reference");
    expect(recapAIRequest({ ...request, kind: "previous_episode" }).question).toContain(
      "previous episode",
    );
    expect(
      recapFromSegments([
        { id: uid(8), episodeId: null, episodeOrder: 0, start: 0, end: 10, summary: "They meet." },
      ]),
    ).toBe("They meet.");
  });
  it("rejects malformed feature input before it enters retrieval", () => {
    expect(() => sceneSearchAIRequest({ ...request, query: "" })).toThrow();
    expect(() =>
      recapFromSegments([
        { id: uid(8), episodeId: null, episodeOrder: 0, start: 3, end: 2, summary: "Impossible" },
      ]),
    ).toThrow();
  });
});
