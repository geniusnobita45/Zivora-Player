// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { BufferMonitor } from "@/core/streaming/BufferMonitor";
const sample = {
  position: 10,
  playing: true,
  seeking: false,
  bufferedRanges: [{ start: 0, end: 20 }],
  bandwidth: 1000000,
};
afterEach(() => vi.useRealTimers());
describe("buffer monitor", () => {
  it("counts only contiguous buffered media and reports health", () => {
    const monitor = new BufferMonitor();
    expect(
      monitor.sample({
        ...sample,
        bufferedRanges: [
          { start: 50, end: 100 },
          { start: 0, end: 15 },
          { start: 14, end: 20 },
        ],
      }),
    ).toMatchObject({ ahead: 10, health: "healthy" });
    expect(monitor.sample({ ...sample, bufferedRanges: [{ start: 0, end: 11 }] })).toMatchObject({
      ahead: 1,
      health: "low",
    });
    expect(monitor.sample({ ...sample, bufferedRanges: [{ start: 11, end: 20 }] })).toMatchObject({
      ahead: 0,
      health: "empty",
    });
  });
  it("detects one stall transition and resets when progress resumes", () => {
    let now = 0;
    const monitor = new BufferMonitor(() => now);
    const start = vi.fn();
    const end = vi.fn();
    monitor.on("stallstart", start);
    monitor.on("stallend", end);
    monitor.sample(sample);
    now = 1999;
    expect(monitor.sample(sample).stalled).toBe(false);
    now = 2000;
    expect(monitor.sample(sample).stalled).toBe(true);
    now = 5000;
    monitor.sample(sample);
    expect(start).toHaveBeenCalledOnce();
    expect(monitor.sample({ ...sample, position: 11 }).stalled).toBe(false);
    expect(end).toHaveBeenCalledOnce();
  });
  it("does not classify paused, seeking, or clock rollback as a stall", () => {
    let now = 10000;
    const monitor = new BufferMonitor(() => now);
    monitor.sample(sample);
    now = 0;
    expect(monitor.sample(sample).stalled).toBe(false);
    now = 10000;
    expect(monitor.sample({ ...sample, playing: false }).stalled).toBe(false);
    now = 20000;
    expect(monitor.sample({ ...sample, seeking: true }).stalled).toBe(false);
    now = 30000;
    expect(monitor.sample(sample).stalled).toBe(false);
  });
  it("bounds bandwidth samples and protects internal snapshots", () => {
    const monitor = new BufferMonitor(() => 0, 2000, 2, 2);
    for (const bandwidth of [100, 200, 300]) monitor.sample({ ...sample, bandwidth });
    expect(monitor.getSnapshot().averageBandwidth).toBe(250);
    expect(monitor.getBandwidthSamples()).toHaveLength(2);
    monitor.getBandwidthSamples()[0].bitsPerSecond = 900;
    expect(monitor.getBandwidthSamples()[0].bitsPerSecond).toBe(200);
    expect(() => monitor.sample({ ...sample, bandwidth: Infinity })).toThrow();
  });
  it("samples while media events are stalled and cleans up its interval", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const monitor = new BufferMonitor();
    monitor.start(() => sample, 500);
    await vi.advanceTimersByTimeAsync(2500);
    expect(monitor.getSnapshot().stalled).toBe(true);
    monitor.destroy();
    expect(vi.getTimerCount()).toBe(0);
    expect(() => monitor.sample(sample)).toThrow();
  });
  it("isolates failed metric reads from the playback path", async () => {
    vi.useFakeTimers();
    const monitor = new BufferMonitor();
    const errors = vi.fn();
    monitor.on("error", errors);
    monitor.start(() => {
      throw new Error("Metrics unavailable");
    });
    await vi.advanceTimersByTimeAsync(500);
    expect(errors).toHaveBeenCalledOnce();
    monitor.destroy();
  });
});
