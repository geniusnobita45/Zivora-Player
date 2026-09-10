import { afterEach, describe, expect, it, vi } from "vitest";
import { MockAdapter } from "@/core/adapters/MockAdapter";
import { PlayerEngine } from "@/core/player/PlayerEngine";
import { PlayerController, type CommandAuditEvent } from "@/core/player/PlayerController";
import { keyboardCommand } from "@/core/player/PlayerKeyboard";
import { BrowserPlayerPresentation } from "@/core/player/PlayerPresentation";
import { ManifestManager } from "@/core/streaming/ManifestManager";
import { PlaybackError } from "@/core/player/PlayerErrors";

const controllers: PlayerController[] = [];
afterEach(async () => {
  await Promise.all(controllers.splice(0).map((controller) => controller.destroy()));
  vi.useRealTimers();
});
async function fixture(now: () => number = () => 1000) {
  const adapter = new MockAdapter();
  adapter.duration = 100;
  const presentation = {
    toggleFullscreen: vi.fn(async () => {}),
    togglePictureInPicture: vi.fn(async () => {}),
  };
  const engine = new PlayerEngine(adapter, {}, { presentation, trackStorage: null });
  const controller = new PlayerController(engine, now);
  controllers.push(controller);
  await controller.load("https://media.example.com/v1/master.m3u8");
  return { adapter, controller, presentation };
}
describe("controller dispatch and helpers", () => {
  it("uses renewed authorization for recovery while the initial signed load is still pending", async () => {
    const { controller, adapter } = await fixture();
    let failFirst!: () => void;
    const original = adapter.load.bind(adapter);
    const load = vi
      .spyOn(adapter, "load")
      .mockImplementationOnce(
        () =>
          new Promise<void>((_, reject) => {
            failFirst = () =>
              reject(
                new PlaybackError("Expired during startup", {
                  code: "NETWORK",
                  category: "network",
                  fatal: true,
                  recoverable: true,
                }),
              );
          }),
      )
      .mockImplementation(original);
    const manager = new ManifestManager({
      resolve: vi
        .fn()
        .mockResolvedValueOnce({
          url: "https://media.example.com/v1/master.m3u8?token=old",
          expiresAt: Date.now() + 60000,
        })
        .mockResolvedValue({
          url: "https://media.example.com/v1/master.m3u8?token=new",
          expiresAt: Date.now() + 120000,
        }),
    });
    const loading = controller.loadSignedManifest(manager, 25);
    await vi.waitFor(() => expect(load).toHaveBeenCalledOnce());
    await manager.refresh();
    failFirst();
    await loading;
    expect(adapter.loads.at(-1)).toEqual({
      manifestUrl: "https://media.example.com/v1/master.m3u8?token=new",
      startPosition: 25,
    });
    expect(controller.getSnapshot().state).toBe("ready");
  });
  it("routes all helpers through validation and the engine", async () => {
    const { controller, adapter, presentation } = await fixture();
    await controller.play();
    expect(controller.getSnapshot().state).toBe("playing");
    await controller.pause();
    await controller.togglePlay();
    expect(controller.getSnapshot().state).toBe("playing");
    await controller.seekTo(30);
    await controller.seekBy(-10);
    expect(adapter.position).toBe(20);
    await controller.setVolume(0.3);
    await controller.setMuted(true);
    await controller.setPlaybackRate(3);
    await controller.selectQuality("720");
    expect(controller.getStreamingSnapshot().quality.automatic).toBe(false);
    await controller.enableAutoQuality();
    expect(controller.getSnapshot().qualityId).toBe("auto");
    await controller.selectAudio("en-US");
    await controller.selectSubtitle("en");
    expect(controller.getSnapshot()).toMatchObject({
      volume: 0.3,
      muted: true,
      rate: 3,
      audioTrackId: "en",
      textTrackId: "en",
    });
    await controller.selectSubtitle(null);
    expect(controller.getSnapshot().textTrackId).toBeNull();
    await controller.toggleFullscreen();
    await controller.togglePictureInPicture();
    expect(presentation.toggleFullscreen).toHaveBeenCalledOnce();
    expect(presentation.togglePictureInPicture).toHaveBeenCalledOnce();
  });
  it("audits accepted, successful, rejected and failed actions, without logging unknown raw input", async () => {
    const { controller } = await fixture();
    const audit: CommandAuditEvent[] = [];
    controller.on("commandaudit", (event) => {
      audit.push(event);
    });
    controller.on("commandaudit", () => {
      throw new Error("Analytics unavailable");
    });
    expect((await controller.play({ source: "gesture", reason: "Tap" })).ok).toBe(true);
    const invalid = await controller.dispatch({ type: "INVALID", token: "sensitive" });
    expect(invalid.ok).toBe(false);
    expect(audit[2]).toMatchObject({ status: "rejected", error: { code: "INVALID_COMMAND" } });
    expect(JSON.stringify(audit)).not.toContain("sensitive");
    const missing = await controller.selectAudio("fr");
    expect(missing.ok).toBe(false);
    expect(audit.map((event) => event.status)).toEqual([
      "accepted",
      "executed",
      "rejected",
      "accepted",
      "failed",
    ]);
    expect(audit[0].id).toBe(audit[1].id);
    expect(audit[0].command).toMatchObject({ source: "gesture", issuedAt: 1000, reason: "Tap" });
    expect(Object.isFrozen(audit[0].command)).toBe(true);
    expect(controller.getSnapshot().state).toBe("playing");
  });
  it("enforces AI limits before executing and leaves user commands available", async () => {
    let now = 0;
    const { controller, adapter } = await fixture(() => now);
    const seek = vi.spyOn(adapter, "seek");
    expect((await controller.seekTo(10, { source: "ai" })).ok).toBe(true);
    expect(await controller.seekTo(20, { source: "ai" })).toMatchObject({
      ok: false,
      error: { code: "RATE_LIMITED" },
    });
    expect(seek).toHaveBeenCalledOnce();
    await controller.seekBy(10);
    expect(adapter.position).toBe(20);
    now = 2000;
    expect((await controller.seekTo(30, { source: "ai" })).ok).toBe(true);
  });
  it("resolves registered skip IDs and clamps their end to duration", async () => {
    const { controller, adapter } = await fixture();
    expect(await controller.skipSegment("intro")).toMatchObject({
      ok: false,
      error: { code: "UNKNOWN_SEGMENT" },
    });
    controller.setSkipSegments([{ id: "intro", start: 0, end: 120 }]);
    await controller.skipSegment("intro");
    expect(adapter.position).toBe(100);
    await controller.load("https://media.example.com/v2/master.m3u8");
    expect((await controller.skipSegment("intro")).ok).toBe(false);
  });
  it("serializes relative seeks and toggles against current engine state", async () => {
    const { controller, adapter } = await fixture();
    await Promise.all([controller.seekBy(5), controller.seekBy(5)]);
    expect(adapter.position).toBe(10);
    await Promise.all([controller.togglePlay(), controller.togglePlay()]);
    expect(controller.getSnapshot().paused).toBe(true);
  });
  it("keeps presentation failures nonfatal and rejects actions after destruction", async () => {
    const { controller, presentation } = await fixture();
    await controller.play();
    presentation.toggleFullscreen.mockRejectedValueOnce(new Error("Denied"));
    expect(await controller.toggleFullscreen()).toMatchObject({
      ok: false,
      error: { fatal: false },
    });
    expect(controller.getSnapshot().state).toBe("playing");
    await controller.destroy();
    expect(await controller.play()).toMatchObject({
      ok: false,
      error: { code: "CONTROLLER_DESTROYED" },
    });
  });
  it("renews the recovery URL without reloading or interrupting active playback", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const { controller, adapter } = await fixture();
    const manager = new ManifestManager({
      resolve: vi
        .fn()
        .mockResolvedValueOnce({
          url: "https://media.example.com/v1/master.m3u8?token=old",
          expiresAt: 60000,
        })
        .mockResolvedValue({
          url: "https://media.example.com/v1/master.m3u8?token=new",
          expiresAt: 90000,
        }),
    });
    await controller.loadSignedManifest(manager);
    await controller.play();
    adapter.tick(44);
    const count = adapter.loads.length;
    await manager.refresh();
    expect(adapter.loads).toHaveLength(count);
    expect(controller.getSnapshot()).toMatchObject({ state: "playing", position: 44 });
    adapter.emit(
      "error",
      new PlaybackError("Offline", {
        code: "NETWORK",
        category: "network",
        fatal: true,
        recoverable: true,
      }),
    );
    await controller.pause();
    expect(adapter.loads.at(-1)).toEqual({
      manifestUrl: "https://media.example.com/v1/master.m3u8?token=new",
      startPosition: 44,
    });
  });
});

describe("keyboard mapping", () => {
  it.each([
    [" ", { type: "TOGGLE_PLAY" }],
    ["K", { type: "TOGGLE_PLAY" }],
    ["j", { type: "SEEK_BY", delta: -10 }],
    ["L", { type: "SEEK_BY", delta: 10 }],
    ["ArrowLeft", { type: "SEEK_BY", delta: -5 }],
    ["ArrowRight", { type: "SEEK_BY", delta: 5 }],
    ["ArrowUp", { type: "SET_VOLUME", level: 0.55 }],
    ["ArrowDown", { type: "SET_VOLUME", level: 0.45 }],
    ["m", { type: "SET_MUTED", muted: true }],
    ["f", { type: "TOGGLE_FULLSCREEN" }],
    ["p", { type: "TOGGLE_PIP" }],
    ...Array.from({ length: 10 }, (_, digit): [string, object] => [
      String(digit),
      { type: "SEEK_TO", seconds: digit * 10 },
    ]),
  ])("maps %s", (key, action) => {
    expect(
      keyboardCommand({ key }, { duration: 100, volume: 0.5, muted: false }, 123),
    ).toMatchObject({ ...(action as object), source: "keyboard", issuedAt: 123 });
  });
  it("ignores modifiers, composition, unknown keys and repeated toggles", () => {
    const snapshot = { duration: 100, volume: 1, muted: false };
    for (const key of [
      { key: "k", ctrlKey: true },
      { key: "k", metaKey: true },
      { key: "k", altKey: true },
      { key: "k", repeat: true },
      { key: "k", isComposing: true },
      { key: "Escape" },
    ])
      expect(keyboardCommand(key, snapshot)).toBeNull();
    expect(keyboardCommand({ key: "ArrowUp" }, snapshot)).toMatchObject({ level: 1 });
  });
  it("does not hijack input fields, and dispatches focused-player shortcuts", async () => {
    const { controller } = await fixture();
    const input = document.createElement("input");
    const editable = new KeyboardEvent("keydown", { key: " ", cancelable: true });
    Object.defineProperty(editable, "target", { value: input });
    expect(controller.handleKey(editable)).toBeNull();
    expect(editable.defaultPrevented).toBe(false);
    const shortcut = new KeyboardEvent("keydown", { key: " ", cancelable: true });
    await controller.handleKey(shortcut);
    expect(shortcut.defaultPrevented).toBe(true);
    expect(controller.getSnapshot().state).toBe("playing");
  });
});

describe("native presentation host", () => {
  it("enters and exits fullscreen and PiP using the video owner's document", async () => {
    const video = document.createElement("video");
    const container = document.createElement("div");
    const fullscreen = vi.fn(async () => {});
    const pip = vi.fn(async () => ({}) as PictureInPictureWindow);
    Object.defineProperty(container, "requestFullscreen", { value: fullscreen });
    Object.defineProperty(video, "requestPictureInPicture", { value: pip });
    const fullExit = vi.fn(async () => {});
    const pipExit = vi.fn(async () => {});
    Object.defineProperties(document, {
      fullscreenElement: { configurable: true, value: null },
      pictureInPictureElement: { configurable: true, value: null },
      pictureInPictureEnabled: { configurable: true, value: true },
      exitFullscreen: { configurable: true, value: fullExit },
      exitPictureInPicture: { configurable: true, value: pipExit },
    });
    const host = new BrowserPlayerPresentation(video, container);
    await host.toggleFullscreen();
    await host.togglePictureInPicture();
    Object.defineProperty(document, "fullscreenElement", { configurable: true, value: container });
    Object.defineProperty(document, "pictureInPictureElement", {
      configurable: true,
      value: video,
    });
    await host.toggleFullscreen();
    await host.togglePictureInPicture();
    expect(fullscreen).toHaveBeenCalledOnce();
    expect(pip).toHaveBeenCalledOnce();
    expect(fullExit).toHaveBeenCalledOnce();
    expect(pipExit).toHaveBeenCalledOnce();
    Object.defineProperty(document, "fullscreenElement", { configurable: true, value: null });
    Object.defineProperty(document, "pictureInPictureElement", { configurable: true, value: null });
  });
});
