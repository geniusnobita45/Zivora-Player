import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SubtitleRenderer } from "@/components/player/subtitles/SubtitleRenderer";
import { PlayerContext } from "@/components/player/PlayerContext";
import { createPlayerStore } from "@/stores/player.store";
import { createSubtitleStore, type SubtitleStore } from "@/stores/subtitle.store";
import { TextPresentationBridge } from "@/core/adapters/TextPresentationBridge";
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
function mount(subtitleStore: SubtitleStore) {
  return render(
    <PlayerContext.Provider
      value={{
        controller: null,
        store: createPlayerStore(),
        subtitleStore,
        item: {
          contentId: "11111111-1111-4111-8111-111111111111",
          episodeId: null,
          title: "Captions",
          description: "",
        },
        next: null,
        perform: () => {},
        retry: () => {},
        resume: () => {},
        playNext: () => {},
      }}
    >
      <video aria-label="Playback continues" />
      <SubtitleRenderer store={subtitleStore} />
    </PlayerContext.Provider>,
  );
}
describe("custom caption renderer", () => {
  it("applies optional speaker/hint presentation without interpreting untrusted HTML", () => {
    const store = createSubtitleStore(null, null);
    mount(store);
    act(() => {
      store.presentation.render(
        [
          {
            id: "a",
            start: 0,
            end: 10,
            text: "<script>untrusted</script>",
            speaker: "Alice",
            hint: "An idiom",
          },
        ],
        true,
      );
    });
    expect(screen.getByText("<script>untrusted</script>")).toBeTruthy();
    expect(document.querySelector("script")).toBeNull();
    expect(screen.queryByText("An idiom")).toBeNull();
    act(() => {
      store.setPreferences({
        ...store.getState().preferences,
        speakerNames: true,
        contextHints: true,
        size: "large",
        position: "top",
      });
    });
    expect(screen.getByText("Alice:")).toBeTruthy();
    expect(screen.getByText("An idiom")).toBeTruthy();
    expect(document.querySelector(".zivora-custom-subtitles")?.getAttribute("data-position")).toBe(
      "top",
    );
    cleanup();
    expect(store.getState().healthy).toBe(false);
  });
  it("contains a React renderer exception and makes native captions available", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const store = createSubtitleStore(null, null);
    store.setState({
      visible: true,
      healthy: true,
      cues: [{ id: "invalid", start: 0, end: 2, text: {} as unknown as string }],
    });
    mount(store);
    expect(store.getState().healthy).toBe(false);
    expect(screen.getByLabelText("Playback continues")).toBeTruthy();
    const native = vi.fn();
    const bridge = new TextPresentationBridge(store.presentation, native);
    bridge.setVisible(true);
    act(() => bridge.update(1));
    expect(native).toHaveBeenLastCalledWith(true);
    bridge.destroy();
  });
});
