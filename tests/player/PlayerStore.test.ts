import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createPlayerStore,
  connectPlayerStore,
  canHideControls,
  revealControls,
  updatePlayerUI,
} from "@/stores/player.store";
import { PlayerController } from "@/core/player/PlayerController";
import { PlayerEngine } from "@/core/player/PlayerEngine";
import { MockAdapter } from "@/core/adapters/MockAdapter";
import { ProgressManager } from "@/core/playback/ProgressManager";
import { resumePosition } from "@/core/playback/ResumeManager";
import { formatTime } from "@/components/player/timeline/time";
afterEach(() => vi.useRealTimers());
describe("player UI projection", () => {
  it("projects engine events, tracks, qualities and independent buffer samples through the controller", async () => {
    vi.useFakeTimers();
    const adapter = new MockAdapter();
    const controller = new PlayerController(new PlayerEngine(adapter));
    const store = createPlayerStore();
    const off = connectPlayerStore(store, controller);
    await controller.load("https://media.test/master.m3u8");
    await controller.play();
    adapter.tick(14);
    expect(store.getState().snapshot).toMatchObject({ state: "playing", position: 14 });
    expect(store.getState().audioTracks[0].language).toBe("en");
    expect(store.getState().qualities[0].height).toBe(720);
    adapter.bufferedRanges = [{ start: 0, end: 40 }];
    await vi.advanceTimersByTimeAsync(1000);
    expect(store.getState().buffer?.ahead).toBe(26);
    await controller.setVolume(0.3);
    expect(store.getState().snapshot?.volume).toBe(0.3);
    off();
    const snapshot = store.getState().snapshot;
    adapter.tick(17);
    await vi.advanceTimersByTimeAsync(1000);
    expect(store.getState().snapshot).toBe(snapshot);
    await controller.destroy();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("isolates stores and only hides controls during unfocused, unobstructed playback", async () => {
    const adapter = new MockAdapter();
    const controller = new PlayerController(new PlayerEngine(adapter));
    const a = createPlayerStore(),
      b = createPlayerStore();
    const off = connectPlayerStore(a, controller);
    await controller.load("https://media.test/master.m3u8");
    await controller.play();
    updatePlayerUI(a, { phase: "ready" });
    expect(canHideControls(a.getState())).toBe(true);
    expect(b.getState().snapshot).toBeNull();
    for (const patch of [
      { focused: true },
      { menu: "settings" as const },
      { resumePosition: 10 },
    ]) {
      updatePlayerUI(a, { focused: false, menu: null, resumePosition: null, ...patch });
      expect(canHideControls(a.getState())).toBe(false);
    }
    updatePlayerUI(a, { controlsVisible: false });
    revealControls(a);
    expect(a.getState().ui.controlsVisible).toBe(true);
    off();
    await controller.destroy();
  });
});
describe("local resume and long-video timing", () => {
  const progress = {
    contentId: "content:episode",
    position: 92,
    duration: 7200,
    updatedAt: "2026-09-08T00:00:00.000Z",
  };
  it("validates storage and preserves in-memory progress when localStorage fails", () => {
    const manager = new ProgressManager({
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("quota");
      },
    });
    expect(manager.save(progress)).toBe(true);
    expect(manager.load(progress.contentId)).toEqual({
      ...progress,
      furthestPosition: progress.position,
    });
    expect(manager.save({ ...progress, position: Infinity })).toBe(false);
    expect(
      new ProgressManager({ getItem: () => "broken JSON", setItem: () => {} }).load(
        progress.contentId,
      ),
    ).toBeNull();
    expect(
      new ProgressManager({
        getItem: () => JSON.stringify({ ...progress, contentId: "someone-else" }),
        setItem: () => {},
      }).load(progress.contentId),
    ).toBeNull();
  });
  it("offers meaningful resumes, skips completed titles and formats multi-hour content", () => {
    expect(resumePosition(progress, 7200)).toBe(92);
    expect(resumePosition({ ...progress, position: 2 }, 7200)).toBeNull();
    expect(resumePosition({ ...progress, position: 7195 }, 7200)).toBeNull();
    expect(formatTime(3661)).toBe("1:01:01");
    expect(formatTime(360000)).toBe("100:00:00");
    expect(formatTime(NaN)).toBe("0:00");
  });
  it("keeps newer in-memory progress when a write fails but older storage remains readable", () => {
    const manager = new ProgressManager({
      getItem: () => JSON.stringify(progress),
      setItem: () => {
        throw new Error("quota");
      },
    });
    const newer = { ...progress, position: 100, updatedAt: "2026-09-08T00:01:00.000Z" };
    manager.save(newer);
    expect(manager.load(progress.contentId)).toEqual({
      ...newer,
      furthestPosition: newer.position,
    });
  });
});
