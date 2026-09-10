import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PlayerContext } from "@/components/player/PlayerContext";
import { PlayerOverlay } from "@/components/player/PlayerOverlay";
import { NextEpisodeCountdown } from "@/components/player/overlays/NextEpisodeCountdown";
import { createPlayerStore, connectPlayerStore, updatePlayerUI } from "@/stores/player.store";
import { PlayerController } from "@/core/player/PlayerController";
import { PlayerEngine } from "@/core/player/PlayerEngine";
import { MockAdapter } from "@/core/adapters/MockAdapter";
import { contentId, episodeId } from "../security/publicationFixture";
const item = { contentId, episodeId, title: "Test title", description: "Episode one" };
const releases: (() => Promise<void>)[] = [];
afterEach(async () => {
  cleanup();
  await Promise.all(releases.splice(0).map((release) => release()));
  vi.useRealTimers();
  vi.restoreAllMocks();
});
async function fixture() {
  const controller = new PlayerController(new PlayerEngine(new MockAdapter()));
  const store = createPlayerStore();
  const disconnect = connectPlayerStore(store, controller);
  await controller.load("https://media.test/master.m3u8");
  await controller.play();
  updatePlayerUI(store, { phase: "ready" });
  releases.push(async () => {
    disconnect();
    await controller.destroy();
  });
  return {
    controller,
    store,
    item,
    next: { ...item, description: "Episode two" },
    perform: vi.fn(),
    retry: vi.fn(),
    resume: vi.fn(),
    playNext: vi.fn(),
  };
}
describe("playback overlays", () => {
  it("hides idle controls but keeps focused controls and settings visible", async () => {
    const f = await fixture();
    vi.useFakeTimers();
    const view = render(
      <PlayerContext.Provider value={f}>
        <PlayerOverlay />
      </PlayerContext.Provider>,
    );
    act(() => vi.advanceTimersByTime(3000));
    expect(view.container.querySelector(".zivora-chrome")?.getAttribute("data-visible")).toBe(
      "false",
    );
    act(() => updatePlayerUI(f.store, { controlsVisible: true, focused: true }));
    act(() => vi.advanceTimersByTime(6000));
    expect(view.container.querySelector(".zivora-chrome")?.getAttribute("data-visible")).toBe(
      "true",
    );
    act(() => updatePlayerUI(f.store, { focused: false, menu: "settings" }));
    act(() => vi.advanceTimersByTime(6000));
    expect(view.container.querySelector(".zivora-chrome")?.getAttribute("data-visible")).toBe(
      "true",
    );
  });
  it("cancels the countdown without disabling the explicit next button", async () => {
    const f = await fixture();
    vi.useFakeTimers();
    render(
      <PlayerContext.Provider value={f}>
        <NextEpisodeCountdown />
      </PlayerContext.Provider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel countdown" }));
    act(() => vi.advanceTimersByTime(12000));
    expect(f.playNext).not.toHaveBeenCalled();
    expect(screen.getByText("Autoplay cancelled")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Play next episode" }));
    expect(f.playNext).toHaveBeenCalledOnce();
  });
  it("suspends countdown in a hidden tab and advances once after ten visible seconds", async () => {
    const f = await fixture();
    vi.useFakeTimers();
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    render(
      <PlayerContext.Provider value={f}>
        <NextEpisodeCountdown />
      </PlayerContext.Provider>,
    );
    act(() => vi.advanceTimersByTime(20000));
    expect(f.playNext).not.toHaveBeenCalled();
    visibility.mockReturnValue("visible");
    act(() => vi.advanceTimersByTime(10000));
    expect(f.playNext).toHaveBeenCalledOnce();
    act(() => vi.advanceTimersByTime(10000));
    expect(f.playNext).toHaveBeenCalledOnce();
  });
  it("clears countdown work when its overlay unmounts", async () => {
    const f = await fixture();
    vi.useFakeTimers();
    const view = render(
      <PlayerContext.Provider value={f}>
        <NextEpisodeCountdown />
      </PlayerContext.Provider>,
    );
    view.unmount();
    act(() => vi.advanceTimersByTime(20000));
    expect(f.playNext).not.toHaveBeenCalled();
  });
});
