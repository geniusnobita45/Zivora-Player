import { z } from "zod";
import {
  TelemetryBatchSchema,
  TelemetryContextSchema,
  TelemetryEventSchema,
  type TelemetryContext,
  type TelemetryError,
} from "@/types/telemetry";

export { TelemetryBatchSchema, TelemetryContextSchema, TelemetryEventSchema };

export interface TelemetryTransport {
  send(body: string): boolean;
}

function browserTransport(): TelemetryTransport {
  return {
    send(body) {
      try {
        if (typeof navigator === "undefined" || typeof navigator.sendBeacon !== "function")
          return false;
        return navigator.sendBeacon(
          "/api/telemetry",
          new Blob([body], { type: "application/json" }),
        );
      } catch {
        return false;
      }
    },
  };
}

export function browserTelemetryDimensions(): Pick<
  TelemetryContext,
  "device" | "browser" | "os" | "network"
> {
  const nav = typeof navigator === "undefined" ? undefined : navigator;
  const agent = nav?.userAgent ?? "unknown";
  const device = /iPad|Tablet/i.test(agent)
    ? "tablet"
    : /Mobi|Android/i.test(agent)
      ? "mobile"
      : "desktop";
  const browser = /Edg\//.test(agent)
    ? "Edge"
    : /Firefox\//.test(agent)
      ? "Firefox"
      : /CriOS|Chrome\//.test(agent)
        ? "Chrome"
        : /Safari\//.test(agent)
          ? "Safari"
          : "Other";
  const os = /Windows NT/.test(agent)
    ? "Windows"
    : /Android/.test(agent)
      ? "Android"
      : /iPhone|iPad|iPod/.test(agent)
        ? "iOS"
        : /Mac OS X/.test(agent)
          ? "macOS"
          : /Linux/.test(agent)
            ? "Linux"
            : "Other";
  const connection = nav as
    (Navigator & { connection?: { effectiveType?: string; saveData?: boolean } }) | undefined;
  const network = connection?.connection?.saveData
    ? "save-data"
    : connection?.connection?.effectiveType &&
        /^(slow-2g|2g|3g|4g)$/.test(connection.connection.effectiveType)
      ? connection.connection.effectiveType
      : "unknown";
  return { device, browser, os, network };
}

const nowIso = () => new Date().toISOString();

/** Per-session, best-effort analytics tracker. It deliberately has no retry queue. */
export class TelemetryService {
  private pending: z.infer<typeof TelemetryEventSchema>[] = [];
  private startedAt: number;
  private playingAt: number | null = null;
  private bufferingAt: number | null = null;
  private seekingFrom: number | null = null;
  private seekingAt: number | null = null;
  private startupMs: number | null = null;
  private totalBufferMs = 0;
  private watchDurationMs = 0;
  private failedRequests = 0;
  private positionS: number | null = null;
  private durationS: number | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  constructor(
    private readonly context: () => TelemetryContext,
    private readonly transport: TelemetryTransport = browserTransport(),
    private readonly now = nowIso,
    private readonly clock = () => performance.now(),
  ) {
    this.startedAt = this.clock();
    this.record({ type: "session_started", positionS: null });
  }
  start() {
    if (this.timer || this.stopped) return;
    this.timer = setInterval(() => this.flush(), 30_000);
  }
  updatePosition(positionS: number, durationS: number) {
    if (Number.isFinite(positionS) && positionS >= 0) this.positionS = positionS;
    if (Number.isFinite(durationS) && durationS > 0) this.durationS = durationS;
  }
  ready() {
    if (this.startupMs !== null) return;
    this.startupMs = Math.max(0, this.clock() - this.startedAt);
    this.record({ type: "session_started", positionS: this.positionS, startupMs: this.startupMs });
  }
  playing() {
    if (this.playingAt === null) this.playingAt = this.clock();
    this.record({ type: "playing", positionS: this.positionS });
  }
  paused() {
    this.stopWatching();
    this.record({ type: "paused", positionS: this.positionS });
  }
  bufferingStart() {
    if (this.bufferingAt === null) this.bufferingAt = this.clock();
  }
  bufferingEnd() {
    if (this.bufferingAt === null) return;
    const duration = Math.max(0, this.clock() - this.bufferingAt);
    this.bufferingAt = null;
    this.totalBufferMs += duration;
    this.record({ type: "buffering", positionS: this.positionS, bufferDurationMs: duration });
  }
  seeking(positionS: number) {
    this.seekingFrom = positionS;
    this.seekingAt = this.clock();
  }
  seeked(positionS: number) {
    const from = this.seekingFrom;
    const latency = this.seekingAt === null ? null : Math.max(0, this.clock() - this.seekingAt);
    this.seekingFrom = null;
    this.seekingAt = null;
    if (from !== null)
      this.record({
        type: "seek",
        positionS,
        seekFromS: from,
        seekToS: positionS,
        seekLatencyMs: latency,
      });
  }
  quality(
    input: { id: string; height?: number; bandwidth?: number } | null,
    bandwidthEstimate: number,
  ) {
    if (!input) return;
    this.record({
      type: "quality",
      positionS: this.positionS,
      renditionId: input.id,
      renditionHeight: input.height ?? null,
      renditionBitrate: input.bandwidth ?? null,
      bandwidthEstimate: Number.isFinite(bandwidthEstimate) ? Math.max(0, bandwidthEstimate) : null,
    });
  }
  failedRequest() {
    this.failedRequests++;
  }
  error(error: TelemetryError) {
    if (error.category === "network" || error.category === "manifest") this.failedRequest();
    this.record({ type: "error", positionS: this.positionS, error });
  }
  ended() {
    this.stopWatching();
    this.record({ type: "ended", positionS: this.positionS });
    this.flush();
  }
  private stopWatching() {
    if (this.playingAt !== null) this.watchDurationMs += Math.max(0, this.clock() - this.playingAt);
    this.playingAt = null;
  }
  private snapshot() {
    if (this.playingAt !== null) {
      this.watchDurationMs += Math.max(0, this.clock() - this.playingAt);
      this.playingAt = this.clock();
    }
    const completion =
      this.positionS !== null && this.durationS && this.durationS > 0
        ? Math.min(100, (this.positionS / this.durationS) * 100)
        : null;
    return {
      type: "session_snapshot" as const,
      positionS: this.positionS,
      startupMs: this.startupMs,
      watchDurationMs: this.watchDurationMs,
      totalBufferMs: this.totalBufferMs,
      completionPercentage: completion,
      failedRequests: this.failedRequests,
    };
  }
  private record(input: Record<string, unknown>) {
    if (this.stopped) return;
    try {
      if (this.pending.length >= 63) this.flush();
      this.pending.push(TelemetryEventSchema.parse({ ...input, at: this.now() }));
    } catch {
      // Telemetry validation is intentionally failure-isolated.
    }
  }
  flush() {
    if (this.stopped) return false;
    const events = [
      ...this.pending,
      TelemetryEventSchema.parse({ ...this.snapshot(), at: this.now() }),
    ];
    this.pending = [];
    try {
      const body = JSON.stringify(
        TelemetryBatchSchema.parse({
          schemaVersion: 1,
          sentAt: this.now(),
          sessions: [{ context: TelemetryContextSchema.parse(this.context()), events }],
        }),
      );
      return this.transport.send(body);
    } catch {
      return false;
    }
  }
  dispose() {
    if (this.stopped) return;
    this.flush();
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
