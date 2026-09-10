import { describe, expect, it, vi } from "vitest";
import { MockAdapter } from "@/core/adapters/MockAdapter";
import { PlayerEngine } from "@/core/player/PlayerEngine";
import { PlayerController } from "@/core/player/PlayerController";
import { PlaybackError } from "@/core/player/PlayerErrors";
import type { AdapterLoadOptions } from "@/core/adapters/PlaybackAdapter";

const manifest = "https://media.example.com/v1/master.m3u8";
const networkError = () =>
  new PlaybackError("Connection lost", {
    code: "NETWORK_TIMEOUT",
    category: "network",
    fatal: true,
    recoverable: true,
  });
const fatalError = () =>
  new PlaybackError("Invalid manifest", {
    code: "INVALID_MANIFEST",
    category: "manifest",
    fatal: true,
    recoverable: false,
  });
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("PlayerEngine state machine", () => {
  it("runs idle -> loading -> ready -> playing -> buffering -> playing -> paused -> ended", async () => {
    const adapter = new MockAdapter();
    const engine = new PlayerEngine(adapter, { startupPosition: 42 });
    const controller = new PlayerController(engine);
    expect(engine.getSnapshot().state).toBe("idle");
    const gate = deferred();
    const originalLoad = adapter.load.bind(adapter);
    vi.spyOn(adapter, "load").mockImplementation(async (...args) => {
      await gate.promise;
      return originalLoad(...args);
    });
    const load = engine.load(manifest);
    await vi.waitFor(() => expect(engine.getSnapshot().state).toBe("loading"));
    gate.resolve();
    await load;
    expect(engine.getSnapshot()).toMatchObject({ state: "ready", position: 42, duration: 7200 });
    await controller.dispatch({ source: "ui", issuedAt: 0, type: "PLAY" });
    expect(engine.getSnapshot().state).toBe("playing");
    adapter.emit("bufferingstart", undefined);
    adapter.emit("bufferingstart", undefined);
    expect(engine.getSnapshot().state).toBe("buffering");
    adapter.emit("bufferingend", undefined);
    expect(engine.getSnapshot().state).toBe("playing");
    await controller.dispatch({ source: "ui", issuedAt: 0, type: "PAUSE" });
    expect(engine.getSnapshot().state).toBe("paused");
    adapter.emit("ended", undefined);
    adapter.emit("paused", undefined);
    adapter.emit("bufferingstart", undefined);
    expect(engine.getSnapshot().state).toBe("ended");
    await controller.dispatch({ source: "ui", issuedAt: 0, type: "PLAY" });
    expect(engine.getSnapshot().state).toBe("playing");
  });

  it("restores a paused state after buffering and honors pause during buffering", async () => {
    const adapter = new MockAdapter();
    const engine = new PlayerEngine(adapter);
    await engine.load(manifest);
    await engine.execute({ source: "ui", issuedAt: 0, type: "PAUSE" });
    adapter.emit("bufferingstart", undefined);
    adapter.emit("bufferingend", undefined);
    expect(engine.getSnapshot().state).toBe("paused");
    await engine.execute({ source: "ui", issuedAt: 0, type: "PLAY" });
    adapter.emit("bufferingstart", undefined);
    await engine.execute({ source: "ui", issuedAt: 0, type: "PAUSE" });
    adapter.emit("bufferingend", undefined);
    expect(engine.getSnapshot()).toMatchObject({ state: "paused", paused: true });
  });

  it("validates commands before touching the adapter and clamps seeking to duration", async () => {
    const adapter = new MockAdapter();
    const engine = new PlayerEngine(adapter);
    const play = vi.spyOn(adapter, "play");
    expect(() => engine.execute({ source: "ui", issuedAt: 0, type: "FLY" })).toThrow();
    await expect(engine.execute({ source: "ui", issuedAt: 0, type: "PLAY" })).rejects.toMatchObject(
      { code: "NOT_READY" },
    );
    expect(play).not.toHaveBeenCalled();
    await engine.load(manifest);
    expect(() =>
      engine.execute({ source: "ui", issuedAt: 0, type: "SEEK_TO", seconds: NaN }),
    ).toThrow();
    expect(() => engine.execute({ source: "ui", issuedAt: 0, type: "SELECT_QUALITY" })).toThrow();
    await engine.execute({ source: "ui", issuedAt: 0, type: "SEEK_TO", seconds: 100_000 });
    expect(engine.getSnapshot()).toMatchObject({ position: 7200, seeking: false });
  });

  it("tracks settings and exposes an immutable snapshot", async () => {
    const adapter = new MockAdapter();
    const engine = new PlayerEngine(adapter);
    await engine.load(manifest);
    await engine.execute({ source: "ui", issuedAt: 0, type: "SET_VOLUME", level: 0.3 });
    await engine.execute({ source: "ui", issuedAt: 0, type: "SET_MUTED", muted: true });
    await engine.execute({ source: "ui", issuedAt: 0, type: "SET_RATE", rate: 1.5 });
    await engine.execute({ source: "ui", issuedAt: 0, type: "SELECT_QUALITY", id: "720" });
    await engine.execute({ source: "ui", issuedAt: 0, type: "SELECT_AUDIO", lang: "en" });
    await engine.execute({ source: "ui", issuedAt: 0, type: "SELECT_SUBTITLE", lang: "en" });
    expect(engine.getSnapshot()).toMatchObject({
      volume: 0.3,
      muted: true,
      rate: 1.5,
      qualityId: "720",
      audioTrackId: "en",
      textTrackId: "en",
    });
    expect(Object.isFrozen(engine.getSnapshot())).toBe(true);
    await engine.execute({ source: "ui", issuedAt: 0, type: "SELECT_SUBTITLE", lang: null });
    await engine.execute({ source: "ui", issuedAt: 0, type: "ENABLE_AUTO_QUALITY" });
    expect(engine.getSnapshot()).toMatchObject({ qualityId: "auto", textTrackId: null });
  });

  it("ignores unsolicited state events before load", () => {
    const adapter = new MockAdapter();
    const engine = new PlayerEngine(adapter);
    adapter.emit("playing", undefined);
    adapter.emit("bufferingstart", undefined);
    adapter.emit("ended", undefined);
    expect(engine.getSnapshot().state).toBe("idle");
  });
});

describe("PlayerEngine recovery", () => {
  it("preserves the last position if delayed media events arrive after a fatal error", async () => {
    const adapter = new MockAdapter();
    const engine = new PlayerEngine(adapter);
    await engine.load(manifest);
    adapter.tick(60);
    adapter.emit("error", fatalError());
    adapter.emit("seeking", { position: 0 });
    adapter.emit("seeked", { position: 0 });
    adapter.emit("timeupdate", { position: 0, duration: 7200 });
    expect(engine.getSnapshot()).toMatchObject({ state: "error", position: 60, seeking: false });
  });
  it("recovers a rejected control operation through the same bounded reload path", async () => {
    const adapter = new MockAdapter();
    const engine = new PlayerEngine(adapter);
    await engine.load(manifest);
    adapter.tick(40);
    vi.spyOn(adapter, "play").mockRejectedValueOnce(networkError());
    await engine.execute({ source: "ui", issuedAt: 0, type: "PLAY" });
    expect(adapter.loads[1].startPosition).toBe(40);
    expect(engine.getSnapshot()).toMatchObject({ state: "playing", recoveryAttempts: 1 });
  });

  it("keeps autoplay denial nonfatal and available for a later user gesture", async () => {
    const adapter = new MockAdapter();
    const engine = new PlayerEngine(adapter, { autoplay: true });
    const error = new PlaybackError("Gesture required", {
      code: "AUTOPLAY_BLOCKED",
      category: "adapter",
      fatal: false,
      recoverable: false,
    });
    vi.spyOn(adapter, "play").mockRejectedValueOnce(error);
    await expect(engine.load(manifest)).rejects.toBe(error);
    expect(engine.getSnapshot()).toMatchObject({
      state: "ready",
      paused: true,
      recoveryAttempts: 0,
    });
    await engine.execute({ source: "ui", issuedAt: 0, type: "PLAY" });
    expect(engine.getSnapshot().state).toBe("playing");
  });

  it("keeps nonfatal runtime errors from interrupting playback", async () => {
    const adapter = new MockAdapter();
    const engine = new PlayerEngine(adapter);
    await engine.load(manifest);
    await engine.execute({ source: "ui", issuedAt: 0, type: "PLAY" });
    adapter.emit(
      "error",
      new PlaybackError("Caption unavailable", {
        code: "CAPTION_UNAVAILABLE",
        category: "media",
        fatal: false,
        recoverable: false,
      }),
    );
    expect(engine.getSnapshot().state).toBe("playing");
    expect(adapter.loads).toHaveLength(1);
  });

  it("stops recovery when a retry reports a permanent failure", async () => {
    const adapter = new MockAdapter();
    const engine = new PlayerEngine(adapter);
    adapter.loadFailures.push(networkError(), fatalError());
    await expect(engine.load(manifest)).rejects.toMatchObject({ code: "INVALID_MANIFEST" });
    expect(adapter.loads).toHaveLength(2);
    expect(engine.getSnapshot().state).toBe("error");
  });

  it("cancels an in-flight recovery when a different manifest is requested", async () => {
    const adapter = new MockAdapter();
    const engine = new PlayerEngine(adapter);
    await engine.load(manifest);
    await engine.execute({ source: "ui", issuedAt: 0, type: "PLAY" });
    const gate = deferred();
    const original = adapter.load.bind(adapter);
    vi.spyOn(adapter, "load")
      .mockImplementationOnce(async (...args) => {
        await gate.promise;
        return original(...args);
      })
      .mockImplementation(original);
    adapter.emit("error", networkError());
    await vi.waitFor(() => expect(engine.getSnapshot().state).toBe("loading"));
    const nextUrl = "https://media.example.com/v2/master.m3u8";
    const load = engine.load(nextUrl, 12);
    gate.resolve();
    await load;
    expect(engine.getSnapshot()).toMatchObject({
      state: "ready",
      manifestUrl: nextUrl,
      position: 12,
      recoveryAttempts: 0,
    });
    expect(adapter.loads).toHaveLength(3);
  });
  it("reloads at the last confirmed position and restores playing intent and settings", async () => {
    const adapter = new MockAdapter();
    const engine = new PlayerEngine(adapter);
    await engine.load(manifest);
    await engine.execute({ source: "ui", issuedAt: 0, type: "PLAY" });
    await engine.execute({ source: "ui", issuedAt: 0, type: "SET_VOLUME", level: 0.4 });
    await engine.execute({ source: "ui", issuedAt: 0, type: "SET_RATE", rate: 1.5 });
    adapter.tick(3800.25);
    adapter.emit("error", networkError());
    await vi.waitFor(() => expect(adapter.loads).toHaveLength(2));
    await vi.waitFor(() => expect(engine.getSnapshot().state).toBe("playing"));
    expect(adapter.loads[1]).toEqual({ manifestUrl: manifest, startPosition: 3800.25 });
    expect(engine.getSnapshot()).toMatchObject({
      position: 3800.25,
      volume: 0.4,
      rate: 1.5,
      recoveryAttempts: 1,
      error: null,
    });
  });

  it("does not autoplay a paused session on recovery", async () => {
    const adapter = new MockAdapter();
    const engine = new PlayerEngine(adapter);
    await engine.load(manifest);
    await engine.execute({ source: "ui", issuedAt: 0, type: "PAUSE" });
    adapter.tick(100);
    const play = vi.spyOn(adapter, "play");
    adapter.emit("error", networkError());
    await vi.waitFor(() => expect(adapter.loads).toHaveLength(2));
    await vi.waitFor(() => expect(engine.getSnapshot().state).toBe("ready"));
    expect(play).not.toHaveBeenCalled();
    expect(engine.getSnapshot().paused).toBe(true);
  });

  it("recovers an initial load rejection with at most three reload attempts", async () => {
    const adapter = new MockAdapter();
    const engine = new PlayerEngine(adapter);
    adapter.loadFailures.push(networkError(), networkError(), networkError());
    await engine.load(manifest, 123);
    expect(adapter.loads).toHaveLength(4);
    expect(adapter.loads.every((load) => load.startPosition === 123)).toBe(true);
    expect(engine.getSnapshot()).toMatchObject({ state: "ready", recoveryAttempts: 3 });
  });

  it("stops after three failed recovery attempts and preserves progress", async () => {
    const adapter = new MockAdapter();
    const engine = new PlayerEngine(adapter);
    await engine.load(manifest);
    adapter.tick(98);
    adapter.loadFailures.push(networkError(), networkError(), networkError(), networkError());
    adapter.emit("error", networkError());
    await vi.waitFor(() => expect(engine.getSnapshot().state).toBe("error"));
    expect(adapter.loads).toHaveLength(4);
    expect(engine.getSnapshot()).toMatchObject({
      position: 98,
      recoveryAttempts: 3,
      error: { code: "RECOVERY_EXHAUSTED", recoverable: false },
    });
    adapter.emit("error", networkError());
    await Promise.resolve();
    expect(adapter.loads).toHaveLength(4);
  });

  it("does not reset the budget on each successful reload", async () => {
    const adapter = new MockAdapter();
    const engine = new PlayerEngine(adapter);
    await engine.load(manifest);
    for (let attempt = 1; attempt <= 3; attempt++) {
      adapter.emit("error", networkError());
      await vi.waitFor(() => {
        expect(engine.getSnapshot().recoveryAttempts).toBe(attempt);
        expect(engine.getSnapshot().error).toBeNull();
      });
    }
    adapter.emit("error", networkError());
    await vi.waitFor(() => expect(engine.getSnapshot().state).toBe("error"));
    expect(adapter.loads).toHaveLength(4);
    await engine.load(manifest);
    expect(engine.getSnapshot().recoveryAttempts).toBe(0);
  });

  it("does not retry fatal manifest failures and rejects the load", async () => {
    const adapter = new MockAdapter();
    const engine = new PlayerEngine(adapter);
    const error = fatalError();
    adapter.loadFailures.push(error);
    await expect(engine.load(manifest)).rejects.toBe(error);
    expect(adapter.loads).toHaveLength(1);
    expect(engine.getSnapshot().state).toBe("error");
  });

  it("coalesces duplicate error events into a single recovery", async () => {
    const adapter = new MockAdapter();
    const engine = new PlayerEngine(adapter);
    await engine.load(manifest);
    adapter.emit("error", networkError());
    adapter.emit("error", networkError());
    await vi.waitFor(() => expect(engine.getSnapshot().recoveryAttempts).toBe(1));
    expect(adapter.loads).toHaveLength(2);
  });

  it("handles an error emitted AND rejected by a load once", async () => {
    const adapter = new MockAdapter();
    const engine = new PlayerEngine(adapter);
    const original = adapter.load.bind(adapter);
    const error = networkError();
    vi.spyOn(adapter, "load")
      .mockImplementationOnce(async () => {
        adapter.emit("error", error);
        throw error;
      })
      .mockImplementation(original);
    const errors = vi.fn();
    engine.on("error", errors);
    await engine.load(manifest);
    expect(errors).toHaveBeenCalledTimes(1);
    expect(engine.getSnapshot().recoveryAttempts).toBe(1);
  });

  it("honors pause requested while a recovery load is pending", async () => {
    const adapter = new MockAdapter();
    const engine = new PlayerEngine(adapter);
    await engine.load(manifest);
    await engine.execute({ source: "ui", issuedAt: 0, type: "PLAY" });
    const gate = deferred();
    const load = adapter.load.bind(adapter);
    vi.spyOn(adapter, "load").mockImplementation(async (...args) => {
      await gate.promise;
      return load(...args);
    });
    adapter.emit("error", networkError());
    await vi.waitFor(() => expect(engine.getSnapshot().state).toBe("loading"));
    const pause = engine.execute({ source: "ui", issuedAt: 0, type: "PAUSE" });
    gate.resolve();
    await pause;
    expect(engine.getSnapshot()).toMatchObject({ state: "paused", paused: true });
  });
});

describe("PlayerEngine lifetime", () => {
  it("serializes multiple swaps with a newer load and never leaks an adapter", async () => {
    const original = new MockAdapter();
    const first = new MockAdapter();
    const second = new MockAdapter();
    const engine = new PlayerEngine(original);
    await engine.load(manifest);
    const swap1 = engine.swapAdapter(() => first);
    const swap2 = engine.swapAdapter(() => {
      expect(first.destroyed).toBe(true);
      return second;
    });
    const load = engine.load("https://media.example.com/v2/master.m3u8", 30);
    await Promise.all([swap1, swap2, load]);
    expect(original.destroyCalls).toBe(1);
    expect(first.destroyCalls).toBe(1);
    expect(second.destroyed).toBe(false);
    expect(engine.getSnapshot()).toMatchObject({ position: 30, state: "ready" });
  });

  it("does not create a replacement when disposal fails", async () => {
    const adapter = new MockAdapter();
    const engine = new PlayerEngine(adapter);
    const factory = vi.fn(() => new MockAdapter());
    vi.spyOn(adapter, "destroy").mockRejectedValueOnce(new Error("Disposal failed"));
    await expect(engine.swapAdapter(factory)).rejects.toThrow("Disposal failed");
    expect(factory).not.toHaveBeenCalled();
    expect(engine.getSnapshot().state).toBe("error");
  });
  it("destroys the old adapter before constructing its replacement and restores the session", async () => {
    const old = new MockAdapter();
    const engine = new PlayerEngine(old);
    await engine.load(manifest);
    await engine.execute({ source: "ui", issuedAt: 0, type: "PLAY" });
    old.tick(45);
    const next = new MockAdapter();
    await engine.swapAdapter(() => {
      expect(old.destroyed).toBe(true);
      return next;
    });
    old.emit("timeupdate", { position: 999, duration: 1 });
    old.emit("error", fatalError());
    expect(next.loads[0].startPosition).toBe(45);
    expect(engine.getSnapshot()).toMatchObject({ position: 45, state: "playing" });
  });

  it("can swap an idle adapter without loading media", async () => {
    const engine = new PlayerEngine(new MockAdapter());
    const next = new MockAdapter();
    await engine.swapAdapter(() => next);
    expect(next.loads).toHaveLength(0);
    expect(engine.getSnapshot().state).toBe("idle");
  });

  it("destroys once, cancels a pending load and ignores late events", async () => {
    const gate = deferred();
    class DelayedAdapter extends MockAdapter {
      override async load(url: string, options?: AdapterLoadOptions) {
        await gate.promise;
        return super.load(url, options);
      }
    }
    const adapter = new DelayedAdapter();
    const engine = new PlayerEngine(adapter);
    const destroyed = vi.fn();
    engine.on("destroyed", destroyed);
    const load = engine.load(manifest).catch((error: unknown) => error);
    await vi.waitFor(() => expect(engine.getSnapshot().state).toBe("loading"));
    await engine.destroy();
    await engine.destroy();
    gate.resolve();
    expect(await load).toMatchObject({ code: "ENGINE_DESTROYED" });
    adapter.emit("ready", { position: 99, duration: 300 });
    expect(engine.getSnapshot()).toMatchObject({ state: "idle", destroyed: true, position: 0 });
    expect(adapter.destroyCalls).toBe(1);
    expect(destroyed).toHaveBeenCalledTimes(1);
    expect(() => engine.execute({ source: "ui", issuedAt: 0, type: "PLAY" })).toThrow();
  });

  it("supersedes an older load without accepting its ready event", async () => {
    const adapter = new MockAdapter();
    const engine = new PlayerEngine(adapter);
    const gate = deferred();
    const original = adapter.load.bind(adapter);
    vi.spyOn(adapter, "load")
      .mockImplementationOnce(async (...args) => {
        await gate.promise;
        return original(...args);
      })
      .mockImplementation(original);
    const old = engine.load(manifest, 10).catch((error: unknown) => error);
    await vi.waitFor(() => expect(engine.getSnapshot().state).toBe("loading"));
    const current = engine.load("https://media.example.com/v2/master.m3u8", 20);
    gate.resolve();
    expect(await old).toMatchObject({ code: "OPERATION_CANCELLED" });
    await current;
    expect(engine.getSnapshot()).toMatchObject({
      position: 20,
      manifestUrl: "https://media.example.com/v2/master.m3u8",
      state: "ready",
    });
  });
});
