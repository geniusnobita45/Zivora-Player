import { z } from "zod";
import { TypedEventEmitter } from "@/core/player/PlayerEvents";
const RangeSchema = z
  .object({ start: z.number().finite().nonnegative(), end: z.number().finite().nonnegative() })
  .refine((range) => range.end >= range.start);
const SampleSchema = z.object({
  position: z.number().finite().nonnegative(),
  playing: z.boolean(),
  seeking: z.boolean(),
  bufferedRanges: z.array(RangeSchema).max(10_000),
  bandwidth: z.number().finite().nonnegative(),
});
export type BufferSample = z.infer<typeof SampleSchema>;
export interface BandwidthSample {
  at: number;
  bitsPerSecond: number;
}
export interface BufferSnapshot {
  ahead: number;
  health: "empty" | "low" | "healthy";
  stalled: boolean;
  bandwidth: number;
  averageBandwidth: number;
}
export class BufferMonitor extends TypedEventEmitter<{
  stallstart: BufferSnapshot;
  stallend: BufferSnapshot;
  error: unknown;
}> {
  private previous: { position: number; movingAt: number; at: number; playing: boolean } | null =
    null;
  private samples: BandwidthSample[] = [];
  private snapshot: BufferSnapshot = {
    ahead: 0,
    health: "empty",
    stalled: false,
    bandwidth: 0,
    averageBandwidth: 0,
  };
  private timer: ReturnType<typeof setInterval> | null = null;
  private destroyed = false;
  private ranges: { start: number; end: number }[] = [];
  constructor(
    private readonly now: () => number = Date.now,
    private readonly stallMs = 2_000,
    private readonly lowBufferSeconds = 2,
    private readonly sampleLimit = 120,
  ) {
    super();
    z.number().positive().finite().parse(stallMs);
    z.number().positive().finite().parse(lowBufferSeconds);
    z.number().int().positive().max(10_000).parse(sampleLimit);
  }
  sample(input: unknown): BufferSnapshot {
    if (this.destroyed) throw new Error("Buffer monitor is destroyed");
    const sample = SampleSchema.parse(input);
    const at = z.number().finite().nonnegative().parse(this.now());
    const ranges = sample.bufferedRanges.sort((a, b) => a.start - b.start);
    this.ranges = ranges.map((r) => ({ ...r }));
    let end = sample.position;
    for (const range of ranges) {
      if (range.start > end + 0.05) break;
      if (range.end >= sample.position) end = Math.max(end, range.end);
    }
    const ahead = Math.max(0, end - sample.position);
    const previous = this.previous;
    const progressed = !previous || Math.abs(sample.position - previous.position) >= 0.01;
    const reset =
      progressed ||
      sample.seeking ||
      !sample.playing ||
      !previous?.playing ||
      at < (previous?.at ?? at);
    const movingAt = reset ? at : previous!.movingAt;
    const stalled = sample.playing && !sample.seeking && at - movingAt >= this.stallMs;
    this.samples.push({ at, bitsPerSecond: sample.bandwidth });
    this.samples = this.samples.slice(-this.sampleLimit);
    const wasStalled = this.snapshot.stalled;
    this.snapshot = {
      ahead,
      health: ahead <= 0.05 ? "empty" : ahead < this.lowBufferSeconds ? "low" : "healthy",
      stalled,
      bandwidth: sample.bandwidth,
      averageBandwidth:
        this.samples.reduce((sum, item) => sum + item.bitsPerSecond, 0) / this.samples.length,
    };
    this.previous = {
      position: sample.position,
      movingAt,
      at,
      playing: sample.playing && !sample.seeking,
    };
    if (stalled !== wasStalled) this.emit(stalled ? "stallstart" : "stallend", this.getSnapshot());
    return this.getSnapshot();
  }
  getSnapshot(): BufferSnapshot {
    return { ...this.snapshot };
  }
  getBufferedRanges() {
    return this.ranges.map((r) => ({ ...r }));
  }
  getBandwidthSamples(): BandwidthSample[] {
    return this.samples.map((sample) => ({ ...sample }));
  }
  start(read: () => BufferSample, intervalMs = 500): void {
    if (this.destroyed) throw new Error("Buffer monitor is destroyed");
    z.number().int().min(50).parse(intervalMs);
    this.stop();
    this.timer = setInterval(() => {
      try {
        this.sample(read());
      } catch (error) {
        this.emit("error", error);
      }
    }, intervalMs);
  }
  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }
  reset(): void {
    this.ranges = [];
    this.previous = null;
    this.samples = [];
    this.snapshot = {
      ahead: 0,
      health: "empty",
      stalled: false,
      bandwidth: 0,
      averageBandwidth: 0,
    };
  }
  destroy(): void {
    this.stop();
    this.destroyed = true;
    this.clear();
  }
}
