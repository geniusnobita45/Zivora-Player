import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Timeline } from "@/components/player/timeline/Timeline";
import { PlayerContext } from "@/components/player/PlayerContext";
import { createPlayerStore, refreshPlayerStore } from "@/stores/player.store";
import { PlayerController } from "@/core/player/PlayerController";
import { PlayerEngine } from "@/core/player/PlayerEngine";
import { MockAdapter } from "@/core/adapters/MockAdapter";
import { TimelineDataSchema } from "@/types/timeline";
beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 1014,
    bottom: 44,
    width: 1014,
    height: 44,
    toJSON() {
      return {};
    },
  });
  vi.stubGlobal(
    "PointerEvent",
    class extends MouseEvent {
      readonly pointerId: number;
      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init);
        this.pointerId = init.pointerId ?? 1;
      }
    },
  );
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function setup() {
  const adapter = new MockAdapter();
  adapter.duration = 86400;
  const controller = new PlayerController(new PlayerEngine(adapter));
  await controller.load("https://media.test/master.m3u8");
  const store = createPlayerStore();
  refreshPlayerStore(store, controller);
  const seek = vi.spyOn(controller, "seekTo");
  render(
    <PlayerContext.Provider
      value={{
        controller,
        store,
        item: {
          contentId: "11111111-1111-4111-8111-111111111111",
          episodeId: null,
          title: "24 hours",
          description: "",
        },
        next: null,
        perform: (fn) => {
          void fn(controller);
        },
        retry: () => {},
        resume: () => {},
        playNext: () => {},
        timeline: TimelineDataSchema.parse({
          chapters: [{ id: "c", title: "Morning", start: 0, end: 3600 }],
          scenes: [{ id: "s", title: "Sunrise", start: 0, end: 300 }],
          bookmarks: [{ id: "b", title: "Saved", start: 600 }],
        }),
      }}
    >
      <Timeline />
    </PlayerContext.Provider>,
  );
  return { controller, seek, slider: screen.getByRole("slider", { name: "Seek" }) };
}
describe("precision timeline", () => {
  it("steps from the pointer zoom anchor rather than the playing position", async () => {
    const f = await setup();
    fireEvent.wheel(f.slider, { deltaY: -100, clientX: 507 });
    fireEvent.keyDown(f.slider, { key: "ArrowRight" });
    expect(f.seek).not.toHaveBeenCalled();
    fireEvent.keyUp(f.slider, { key: "ArrowRight" });
    expect(f.seek).toHaveBeenCalledWith(43210);
    expect(f.slider.closest("[data-zoom]")?.getAttribute("data-zoom")).toBe("GLOBAL");
    await f.controller.destroy();
  });
  it("pinches around the two-pointer midpoint and commits once after both release", async () => {
    const f = await setup();
    fireEvent.pointerDown(f.slider, { pointerId: 1, clientX: 100 });
    fireEvent.pointerDown(f.slider, { pointerId: 2, clientX: 200 });
    fireEvent.pointerMove(f.slider, { pointerId: 2, clientX: 400 });
    expect(f.slider.closest("[data-zoom]")?.getAttribute("data-zoom")).toBe("HOUR");
    fireEvent.pointerUp(f.slider, { pointerId: 1, clientX: 100 });
    fireEvent.lostPointerCapture(f.slider, { pointerId: 1 });
    expect(f.seek).not.toHaveBeenCalled();
    fireEvent.pointerUp(f.slider, { pointerId: 2, clientX: 400 });
    expect(f.seek).toHaveBeenCalledOnce();
    await f.controller.destroy();
  });
  it("zooms with a hold, commits only on release and returns to global", async () => {
    const f = await setup();
    fireEvent.pointerDown(f.slider, { clientX: 507 });
    act(() => vi.advanceTimersByTime(560));
    expect(f.slider.closest("[data-zoom]")?.getAttribute("data-zoom")).toBe("HOUR");
    expect(f.seek).not.toHaveBeenCalled();
    fireEvent.pointerMove(f.slider, { clientX: 600 });
    fireEvent.pointerUp(f.slider, { clientX: 600 });
    expect(f.seek).toHaveBeenCalledOnce();
    expect(f.slider.closest("[data-zoom]")?.getAttribute("data-zoom")).toBe("GLOBAL");
    await f.controller.destroy();
  });
  it("cancels a zoomed draft on escape and clears hold timers", async () => {
    const f = await setup();
    fireEvent.pointerDown(f.slider, { clientX: 300 });
    act(() => vi.advanceTimersByTime(560));
    fireEvent.keyDown(f.slider, { key: "Escape" });
    fireEvent.pointerUp(f.slider);
    act(() => vi.advanceTimersByTime(2000));
    expect(f.seek).not.toHaveBeenCalled();
    expect(f.slider.closest("[data-zoom]")?.getAttribute("data-zoom")).toBe("GLOBAL");
    await f.controller.destroy();
  });
  it("supports wheel and keyboard precision without seeking on keydown", async () => {
    const f = await setup();
    fireEvent.wheel(f.slider, { deltaY: -100, clientX: 7 });
    expect(screen.getByText("Sunrise")).toBeTruthy();
    fireEvent.keyDown(f.slider, { key: "ArrowRight" });
    expect(f.seek).not.toHaveBeenCalled();
    fireEvent.keyUp(f.slider, { key: "ArrowRight" });
    expect(f.seek).toHaveBeenCalledWith(10);
    await f.controller.destroy();
  });
});
