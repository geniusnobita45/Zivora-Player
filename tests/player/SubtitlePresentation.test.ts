import { describe, expect, it, vi } from "vitest";
import { TextPresentationBridge } from "@/core/adapters/TextPresentationBridge";
import { createSubtitleStore } from "@/stores/subtitle.store";
import { TrackManager } from "@/core/streaming/TrackManager";
import { PlayerCommandSchema } from "@/core/player/PlayerCommand";
const cue = { id: "one", start: 1, end: 3, text: "Hello", speaker: "Alex", hint: "A greeting" };
describe("custom subtitles and native fallback", () => {
  it("renders active overlapping cues and uses native text when an observer fails", () => {
    const render = vi.fn(() => true);
    const native = vi.fn();
    const bridge = new TextPresentationBridge({ render }, native);
    bridge.append([cue, { ...cue, id: "two", start: 2, end: 4 }]);
    bridge.setVisible(true);
    bridge.update(2.5);
    expect(render.mock.calls[0]).toEqual([[cue, { ...cue, id: "two", start: 2, end: 4 }], true]);
    expect(native).toHaveBeenLastCalledWith(false);
    render.mockImplementation(() => {
      throw Error("renderer failed");
    });
    bridge.update(2.5);
    expect(native).toHaveBeenLastCalledWith(true);
    bridge.setVisible(false);
    bridge.update(2.5);
    expect(native).toHaveBeenLastCalledWith(false);
    bridge.destroy();
  });
  it("indexes 24-hour cue inventories, deduplicates and removes without stale captions", () => {
    const render = vi.fn(() => true);
    const bridge = new TextPresentationBridge({ render }, () => {});
    const cues = Array.from({ length: 17280 }, (_, i) => ({
      ...cue,
      id: String(i),
      start: i * 5,
      end: i * 5 + 4,
    }));
    bridge.append(cues);
    bridge.append([cues[0]]);
    bridge.setVisible(true);
    bridge.update(86396);
    expect(render).toHaveBeenLastCalledWith([cues[cues.length - 1]], true);
    bridge.remove(86390, 86400);
    bridge.update(86396);
    expect(render).toHaveBeenLastCalledWith([], true);
    bridge.update(2, true);
    expect(render).toHaveBeenLastCalledWith([], false);
    bridge.destroy();
  });
  it("persists preferences per user, handles corrupt storage and falls back on invalid cues", () => {
    const data = new Map<string, string>();
    const storage = {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => {
        data.set(k, v);
      },
    };
    const firstId = "11111111-1111-4111-8111-111111111111",
      secondId = "22222222-2222-4222-8222-222222222222";
    const first = createSubtitleStore(firstId, storage);
    const prefs = {
      ...first.getState().preferences,
      language: "fr",
      kind: "natural",
      speakerNames: true,
      contextHints: true,
    };
    expect(first.setPreferences(prefs)).toBe(true);
    expect(createSubtitleStore(firstId, storage).getState().preferences).toEqual(prefs);
    expect(createSubtitleStore(secondId, storage).getState().preferences.language).toBeNull();
    first.setState({ healthy: true });
    expect(first.presentation.render([cue], true)).toBe(true);
    expect(first.presentation.render([{ ...cue, start: NaN }], true)).toBe(false);
    expect(first.setPreferences({ ...prefs, size: "giant" })).toBe(false);
    const blocked = createSubtitleStore(null, {
      getItem: () => {
        throw Error();
      },
      setItem: () => {
        throw Error();
      },
    });
    expect(blocked.setPreferences(prefs)).toBe(true);
  });
  it("selects translation kinds through the existing validated command", () => {
    const manager = new TrackManager(null);
    manager.setTracks(
      [],
      [
        { id: "a", language: "fr", label: "fr [original]", kind: "original", active: true },
        { id: "b", language: "fr", label: "fr [natural]", kind: "natural", active: false },
      ],
    );
    expect(manager.resolveSubtitle("fr", "natural")?.id).toBe("b");
    expect(manager.resolveSubtitle("fr", "literal")).toBeNull();
    expect(
      PlayerCommandSchema.safeParse({
        type: "SELECT_SUBTITLE",
        lang: "fr",
        kind: "natural",
        source: "ui",
        issuedAt: 1,
      }).success,
    ).toBe(true);
    expect(
      PlayerCommandSchema.safeParse({
        type: "SELECT_SUBTITLE",
        lang: "fr",
        kind: "fake",
        source: "ui",
        issuedAt: 1,
      }).success,
    ).toBe(false);
  });
});
