import { describe, expect, it, vi } from "vitest";
import { TypedEventEmitter } from "@/core/player/PlayerEvents";
import { createPlayerConfig, ManifestUrlSchema } from "@/core/player/PlayerConfig";
import { PlaybackError, toPlaybackError } from "@/core/player/PlayerErrors";
import { MockAdapter } from "@/core/adapters/MockAdapter";

describe("typed event emitter", () => {
  it("isolates throwing and rejecting observers and supports on/off cleanup", async () => {
    const events = new TypedEventEmitter();
    const observer = vi.fn();
    events.on("playing", () => {
      throw new Error("Analytics offline");
    });
    events.on("playing", async () => {
      throw new Error("Sync offline");
    });
    const unsubscribe = events.on("playing", observer);
    expect(() => events.emit("playing", undefined)).not.toThrow();
    await Promise.resolve();
    expect(observer).toHaveBeenCalledTimes(1);
    unsubscribe();
    events.emit("playing", undefined);
    expect(observer).toHaveBeenCalledTimes(1);
    events.on("playing", observer);
    events.off("playing", observer);
    events.emit("playing", undefined);
    expect(observer).toHaveBeenCalledTimes(1);
    events.clear();
  });
});

describe("player configuration and errors", () => {
  it("merges defaults without sharing mutable configuration", () => {
    const config = createPlayerConfig({ buffer: { bufferingGoal: 60 } });
    expect(config).toMatchObject({
      abr: { enabled: true },
      buffer: { bufferingGoal: 60, rebufferingGoal: 2 },
      maxRecoveryAttempts: 3,
      startupPosition: 0,
    });
    config.abr.enabled = false;
    expect(createPlayerConfig().abr.enabled).toBe(true);
  });
  it.each([
    { startupPosition: -1 },
    { maxRecoveryAttempts: 4 },
    { retry: { maxAttempts: 0 } },
    { buffer: { bufferingGoal: 1, rebufferingGoal: 2 } },
    { abr: { defaultBandwidthEstimate: Infinity } },
  ])("rejects invalid configuration %j", (config) => {
    expect(() => createPlayerConfig(config)).toThrow();
  });
  it.each([
    "javascript:alert(1)",
    "file:///video.m3u8",
    "https://user:secret@example.com/video.m3u8",
  ])("rejects unsafe manifest URLs %s", (url) =>
    expect(ManifestUrlSchema.safeParse(url).success).toBe(false),
  );
  it("preserves causes and already-normalized errors", () => {
    const cause = new Error("Original");
    const error = toPlaybackError(cause);
    expect(error).toBeInstanceOf(PlaybackError);
    expect(error.cause).toBe(cause);
    expect(toPlaybackError(error)).toBe(error);
  });
});

describe("MockAdapter contract", () => {
  it("validates controls, resolves tracks, copies metrics and tears down once", async () => {
    const adapter = new MockAdapter();
    await adapter.load("https://media.example.com/master.m3u8");
    await expect(adapter.seek(-1)).rejects.toThrow();
    await expect(adapter.setRate(Infinity)).rejects.toThrow();
    await expect(adapter.selectQuality("absent")).rejects.toThrow();
    await expect(adapter.selectAudio("absent")).rejects.toThrow();
    await expect(adapter.selectText("absent")).rejects.toThrow();
    await expect(adapter.setVolume(2)).rejects.toThrow();
    adapter.bufferedRanges = [{ start: 1, end: 10 }];
    adapter.getBufferedRanges()[0].end = 90;
    expect(adapter.getBufferedRanges()[0].end).toBe(10);
    expect(adapter.getBandwidthEstimate()).toBe(1_000_000);
    await adapter.destroy();
    await adapter.destroy();
    expect(adapter.destroyCalls).toBe(1);
    await expect(adapter.play()).rejects.toMatchObject({ code: "ADAPTER_DESTROYED" });
  });
});
