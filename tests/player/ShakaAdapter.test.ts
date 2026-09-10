import { beforeEach, describe, expect, it, vi } from "vitest";
import { ShakaAdapter, mapShakaError } from "@/core/adapters/ShakaAdapter";
import { PlayerController } from "@/core/player/PlayerController";

type Request = { uris: string[]; headers: Record<string, string> };
const harness = vi.hoisted(() => ({
  imports: 0,
  instances: [] as {
    attach: ReturnType<typeof vi.fn>;
    configure: ReturnType<typeof vi.fn>;
    load: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
    dispatchEvent: (event: Event) => boolean;
    getVariantTracks: ReturnType<typeof vi.fn>;
    getStats: ReturnType<typeof vi.fn>;
    register: ReturnType<typeof vi.fn>;
    unregister: ReturnType<typeof vi.fn>;
    filter: ((type: number, request: Request) => Promise<void>) | null;
  }[],
}));

vi.mock("shaka-player", () => {
  harness.imports++;
  class FakePlayer extends EventTarget {
    static isBrowserSupported() {
      return true;
    }
    video: HTMLVideoElement | null = null;
    filter: ((type: number, request: Request) => Promise<void>) | null = null;
    visible = false;
    variants = [
      {
        id: 1,
        audioId: 10,
        width: 1280,
        height: 720,
        bandwidth: 1_000_000,
        codecs: "avc1",
        active: true,
        language: "en",
        label: "English",
        audioRoles: [],
        channelsCount: 2,
      },
      {
        id: 2,
        audioId: 10,
        width: 1920,
        height: 1080,
        bandwidth: 2_000_000,
        codecs: "avc1",
        active: false,
        language: "en",
        label: "English",
        audioRoles: [],
        channelsCount: 2,
      },
      {
        id: 3,
        audioId: 20,
        width: 1280,
        height: 720,
        bandwidth: 1_000_000,
        codecs: "avc1",
        active: false,
        language: "es",
        label: "Spanish",
        audioRoles: [],
        channelsCount: 2,
      },
    ];
    texts = [{ id: 4, language: "en", label: "English", kind: "subtitles", active: true }];
    attach = vi.fn(async (video: HTMLVideoElement) => {
      this.video = video;
    });
    configure = vi.fn(() => true);
    load = vi.fn(async (url: string, start: number) => {
      if (this.video) this.video.currentTime = start;
      await this.filter?.(0, { uris: [url], headers: {} });
    });
    register = vi.fn((filter: (type: number, request: Request) => Promise<void>) => {
      this.filter = filter;
    });
    unregister = vi.fn(() => {
      this.filter = null;
    });
    destroy = vi.fn(async () => {});
    getVariantTracks = vi.fn(() => this.variants);
    getTextTracks() {
      return this.texts;
    }
    getStats = vi.fn(() => ({ estimatedBandwidth: 4_000_000 }));
    getNetworkingEngine() {
      return { registerRequestFilter: this.register, unregisterRequestFilter: this.unregister };
    }
    selectVariantTrack(track: { id: number }) {
      this.variants.forEach((variant) => {
        variant.active = variant.id === track.id;
      });
    }
    selectAudioLanguage() {}
    selectTextTrack(track: { id: number }) {
      this.texts.forEach((text) => {
        text.active = text.id === track.id;
      });
    }
    setTextTrackVisibility(visible: boolean) {
      this.visible = visible;
    }
    isTextTrackVisible() {
      return this.visible;
    }
    seekRange() {
      return { start: 5, end: 120 };
    }
    constructor() {
      super();
      harness.instances.push(this);
    }
  }
  return {
    default: {
      Player: FakePlayer,
      polyfill: { installAll: vi.fn() },
      net: { NetworkingEngine: { RequestType: { MANIFEST: 0, SEGMENT: 1, LICENSE: 2 } } },
    },
  };
});

function fixture(options: ConstructorParameters<typeof ShakaAdapter>[1] = {}) {
  const video = document.createElement("video");
  Object.defineProperty(video, "duration", { configurable: true, value: 120 });
  vi.spyOn(video, "play").mockImplementation(async () => {
    video.dispatchEvent(new Event("playing"));
  });
  vi.spyOn(video, "pause").mockImplementation(() => {
    video.dispatchEvent(new Event("pause"));
  });
  return { video, adapter: new ShakaAdapter(video, options) };
}
const manifest = "https://media.example.com/v1/master.m3u8";

it("rewrites authorized object URLs before applying the independent DRM/header hook", async () => {
  const authorizeRequest = vi.fn(async ({ uris }: { uris: readonly string[] }) => ({
    uris: uris.map((uri) => `${uri}?signed=yes`),
  }));
  const getRequestHeaders = vi.fn(() => ({ "X-Playback": "authorized" }));
  const { adapter } = fixture({ authorizeRequest, getRequestHeaders });
  await adapter.load(manifest);
  expect(getRequestHeaders).toHaveBeenCalledWith({
    type: "manifest",
    uris: [`${manifest}?signed=yes`],
  });
  const request: Request = { uris: ["https://media.example.com/v1/segment.m4s"], headers: {} };
  await harness.instances[harness.instances.length - 1].filter?.(1, request);
  expect(request.uris[0]).toContain("signed=yes");
  expect(request.headers["X-Playback"]).toBe("authorized");
  await adapter.destroy();
});

it("accepts request authorization through PlayerController without exposing Shaka to UI", async () => {
  const video = document.createElement("video");
  const authorizeRequest = vi.fn(async ({ uris }: { uris: readonly string[] }) => ({
    uris: [...uris],
  }));
  const controller = PlayerController.forVideo(video, video, {}, { authorizeRequest });
  await controller.load(manifest);
  expect(authorizeRequest).toHaveBeenCalledWith({ type: "manifest", uris: [manifest] });
  await controller.destroy();
});
const lastPlayer = () => harness.instances[harness.instances.length - 1];

describe("ShakaAdapter", () => {
  beforeEach(() => {
    harness.instances.length = 0;
  });
  it("defers SDK loading until load and applies ABR, buffering, retry and startup settings", async () => {
    const count = harness.imports;
    const { adapter } = fixture();
    expect(harness.imports).toBe(count);
    expect(harness.instances).toHaveLength(0);
    const ready = vi.fn();
    const loaded = vi.fn();
    adapter.on("ready", ready);
    adapter.on("manifestloaded", loaded);
    await adapter.load(manifest, {
      startPosition: 33,
      config: { buffer: { bufferingGoal: 45 }, retry: { maxAttempts: 2 } },
    });
    const player = lastPlayer();
    expect(player.configure).toHaveBeenCalledWith(
      expect.objectContaining({
        abr: expect.objectContaining({ enabled: true }),
        streaming: expect.objectContaining({ bufferingGoal: 45, preferNativeHls: false }),
        manifest: { retryParameters: expect.objectContaining({ maxAttempts: 2 }) },
      }),
    );
    expect(player.load).toHaveBeenCalledWith(manifest, 33);
    expect(loaded).toHaveBeenCalledWith({ manifestUrl: manifest });
    expect(ready).toHaveBeenCalledWith({ duration: 120, position: 33 });
    await adapter.destroy();
  });

  it("refreshes request auth for each trusted manifest/segment and leaves other origins unchanged", async () => {
    let token = "first";
    const hook = vi.fn(({ uris }: { uris: readonly string[] }) =>
      uris.every((uri) => new URL(uri).origin === "https://media.example.com")
        ? { Authorization: `Bearer ${token}` }
        : undefined,
    );
    const { adapter } = fixture({ getRequestHeaders: hook });
    await adapter.load(manifest);
    const player = lastPlayer();
    token = "second";
    const request = { uris: ["https://media.example.com/v1/segment.m4s"], headers: {} };
    await player.filter!(1, request);
    expect(request.headers).toEqual({ Authorization: "Bearer second" });
    const other = { uris: ["https://license.example.com/license"], headers: {} };
    await player.filter!(2, other);
    expect(other.headers).toEqual({});
    expect(hook).toHaveBeenLastCalledWith({ type: "license", uris: other.uris });
    await adapter.destroy();
    expect(player.unregister).toHaveBeenCalledOnce();
  });

  it("rejects malformed auth headers and unsupported URLs before ready", async () => {
    const { adapter } = fixture({
      getRequestHeaders: () => ({ Authorization: "Bearer bad\r\nInjected: true" }),
    });
    const ready = vi.fn();
    adapter.on("ready", ready);
    await expect(adapter.load("file:///video")).rejects.toThrow();
    expect(harness.instances).toHaveLength(0);
    await expect(adapter.load(manifest)).rejects.toMatchObject({ category: "adapter" });
    expect(ready).not.toHaveBeenCalled();
    await adapter.destroy();
  });

  it("maps video and Shaka events, clamps seeks, and unregisters listeners on destroy", async () => {
    const { video, adapter } = fixture();
    await adapter.load(manifest);
    const time = vi.fn();
    const play = vi.fn();
    const pause = vi.fn();
    const buffering = vi.fn();
    const endBuffer = vi.fn();
    const seeking = vi.fn();
    const seeked = vi.fn();
    const rate = vi.fn();
    const volume = vi.fn();
    const ended = vi.fn();
    adapter.on("timeupdate", time);
    adapter.on("playing", play);
    adapter.on("paused", pause);
    adapter.on("bufferingstart", buffering);
    adapter.on("bufferingend", endBuffer);
    adapter.on("seeking", seeking);
    adapter.on("seeked", seeked);
    adapter.on("ratechange", rate);
    adapter.on("volumechange", volume);
    adapter.on("ended", ended);
    await adapter.play();
    await adapter.pause();
    await adapter.seek(999);
    video.dispatchEvent(new Event("seeking"));
    video.dispatchEvent(new Event("seeked"));
    video.dispatchEvent(new Event("timeupdate"));
    expect(time).toHaveBeenLastCalledWith({ position: 120, duration: 120 });
    expect(seeking).toHaveBeenLastCalledWith({ position: 120 });
    expect(seeked).toHaveBeenLastCalledWith({ position: 120 });
    await adapter.seek(0);
    expect(video.currentTime).toBe(5);
    // The real SDK temporarily sets zero while buffering; it is not a user rate.
    const errors = vi.fn();
    adapter.on("error", errors);
    video.playbackRate = 0;
    video.dispatchEvent(new Event("ratechange"));
    expect(errors).not.toHaveBeenCalled();
    expect(rate).not.toHaveBeenCalled();
    await adapter.setRate(1.5);
    video.dispatchEvent(new Event("ratechange"));
    expect(rate).toHaveBeenLastCalledWith({ rate: 1.5 });
    await adapter.setVolume(0.4);
    await adapter.setMuted(true);
    video.dispatchEvent(new Event("volumechange"));
    expect(volume).toHaveBeenLastCalledWith({ volume: 0.4, muted: true });
    const player = lastPlayer();
    player.dispatchEvent(Object.assign(new Event("buffering"), { buffering: true }));
    player.dispatchEvent(Object.assign(new Event("buffering"), { buffering: true }));
    player.dispatchEvent(Object.assign(new Event("buffering"), { buffering: false }));
    video.dispatchEvent(new Event("ended"));
    expect(buffering).toHaveBeenCalledOnce();
    expect(endBuffer).toHaveBeenCalledOnce();
    expect(play).toHaveBeenCalledOnce();
    expect(pause).toHaveBeenCalledOnce();
    expect(ended).toHaveBeenCalledOnce();
    const destroyed = vi.fn();
    adapter.on("destroyed", destroyed);
    await adapter.destroy();
    await adapter.destroy();
    const calls = time.mock.calls.length;
    video.dispatchEvent(new Event("timeupdate"));
    expect(time).toHaveBeenCalledTimes(calls);
    expect(player.destroy).toHaveBeenCalledOnce();
    expect(destroyed).toHaveBeenCalledOnce();
    await expect(adapter.play()).rejects.toMatchObject({ code: "ADAPTER_DESTROYED" });
  });

  it("selects quality, audio and captions without exposing SDK track objects", async () => {
    const { adapter } = fixture();
    await adapter.load(manifest);
    expect(adapter.getAudioTracks().map((track) => track.id)).toEqual(["10", "20"]);
    const quality = vi.fn();
    const audio = vi.fn();
    const text = vi.fn();
    adapter.on("qualitychange", quality);
    adapter.on("audiochange", audio);
    adapter.on("textchange", text);
    await adapter.selectQuality("2");
    expect(quality).toHaveBeenLastCalledWith({
      quality: expect.objectContaining({ id: "2", height: 1080 }),
      automatic: false,
    });
    await adapter.selectQuality("auto");
    expect(lastPlayer().configure).toHaveBeenLastCalledWith({ abr: { enabled: true } });
    await adapter.selectAudio("20");
    expect(audio).toHaveBeenLastCalledWith({
      track: expect.objectContaining({ id: "20", language: "es" }),
    });
    await adapter.selectText("4");
    expect(text).toHaveBeenLastCalledWith({
      track: expect.objectContaining({ id: "4", active: true }),
    });
    await adapter.selectText(null);
    expect(text).toHaveBeenLastCalledWith({ track: null });
    await expect(adapter.selectQuality("missing")).rejects.toMatchObject({
      code: "TRACK_NOT_FOUND",
    });
    await expect(adapter.selectAudio("missing")).rejects.toThrow();
    await expect(adapter.selectText("missing")).rejects.toThrow();
    await adapter.destroy();
  });

  it("returns normalized buffered ranges and finite bandwidth", async () => {
    const { adapter, video } = fixture();
    await adapter.load(manifest);
    Object.defineProperty(video, "buffered", {
      value: { length: 2, start: (i: number) => [0, 30][i], end: (i: number) => [20, 50][i] },
    });
    expect(adapter.getBufferedRanges()).toEqual([
      { start: 0, end: 20 },
      { start: 30, end: 50 },
    ]);
    expect(adapter.getBandwidthEstimate()).toBe(4_000_000);
    lastPlayer().getStats.mockReturnValue({ estimatedBandwidth: NaN });
    expect(adapter.getBandwidthEstimate()).toBe(0);
    await adapter.destroy();
    expect(adapter.getBufferedRanges()).toEqual([]);
    expect(adapter.getBandwidthEstimate()).toBe(0);
  });

  it("maps runtime errors, handles rejected reloads and preserves the original cause", async () => {
    const { adapter } = fixture();
    await adapter.load(manifest);
    const errors = vi.fn();
    adapter.on("error", errors);
    const cause = { code: 1003, category: 1, severity: 2 };
    lastPlayer().dispatchEvent(new CustomEvent("error", { detail: cause }));
    expect(errors).toHaveBeenLastCalledWith(
      expect.objectContaining({
        code: "SHAKA_1003",
        category: "network",
        fatal: true,
        recoverable: true,
        cause,
      }),
    );
    lastPlayer().load.mockRejectedValueOnce(cause);
    await expect(adapter.load(manifest)).rejects.toMatchObject({ code: "SHAKA_1003", cause });
    expect(errors).toHaveBeenCalledOnce();
    await adapter.destroy();
  });

  it("does not construct Shaka when destroyed during its lazy import", async () => {
    const { adapter } = fixture();
    const load = adapter.load(manifest).catch((cause: unknown) => cause);
    await adapter.destroy();
    expect(await load).toMatchObject({ code: "ADAPTER_DESTROYED" });
    expect(harness.instances).toHaveLength(0);
  });
});

describe("Shaka error classification", () => {
  it.each([
    [1002, 1, 2, undefined, "network", true],
    [1001, 1, 2, ["uri", 503], "network", true],
    [1001, 1, 2, ["uri", 429], "network", true],
    [1001, 1, 2, ["uri", 403], "network", false],
    [1001, 1, 2, ["uri", 404], "network", false],
    [1006, 1, 1, undefined, "network", false],
    [3001, 3, 1, undefined, "media", true],
    [4000, 4, 2, undefined, "manifest", false],
    [6001, 6, 2, undefined, "drm", false],
    [7000, 7, 2, undefined, "adapter", false],
    [9999, 99, 2, undefined, "unknown", false],
  ])("classifies code %s", (code, category, severity, data, expectedCategory, recoverable) => {
    expect(mapShakaError({ code, category, severity, data })).toMatchObject({
      category: expectedCategory,
      recoverable,
      fatal: severity === 2,
    });
  });
  it("treats autoplay denial as nonfatal and does not retry it", () => {
    expect(mapShakaError(new DOMException("Denied", "NotAllowedError"))).toMatchObject({
      code: "AUTOPLAY_BLOCKED",
      fatal: false,
      recoverable: false,
    });
  });
});
