import { describe, expect, it } from "vitest";
import { PlaybackError } from "@/core/player/PlayerErrors";
import { ErrorReporter } from "@/services/telemetry/ErrorReporter";
import { displayPercent, isAnalyticsAdmin } from "@/services/telemetry/PlaybackMetrics";
import { TelemetryService } from "@/services/telemetry/TelemetryService";
import { TelemetryBatchSchema, type TelemetryContext } from "@/types/telemetry";

const context: TelemetryContext = {
  sessionId: "11111111-1111-4111-8111-111111111111",
  userId: "22222222-2222-4222-8222-222222222222",
  contentId: "33333333-3333-4333-8333-333333333333",
  episodeId: null,
  mediaVersionId: "44444444-4444-4444-8444-444444444444",
  device: "desktop",
  browser: "Chrome",
  os: "Linux",
  network: "4g",
};
describe("TelemetryService", () => {
  it("formats aggregate values and recognizes only the trusted admin claim", () => {
    expect(displayPercent(0.0125)).toBe("1.25%");
    expect(isAnalyticsAdmin({ app_metadata: { is_admin: true } })).toBe(true);
    expect(isAnalyticsAdmin({ app_metadata: { is_admin: false } })).toBe(false);
    expect(isAnalyticsAdmin({ user_metadata: { is_admin: true }, app_metadata: {} })).toBe(false);
  });
  it("batches session metrics, buffers, seeks, qualities and safe errors without retrying failures", () => {
    let time = 0;
    const sent: string[] = [];
    const telemetry = new TelemetryService(
      () => context,
      { send: (body) => (sent.push(body), false) },
      () => "2026-09-09T00:00:00.000Z",
      () => time,
    );
    telemetry.updatePosition(5, 100);
    time = 150;
    telemetry.ready();
    telemetry.playing();
    time = 650;
    telemetry.bufferingStart();
    time = 900;
    telemetry.bufferingEnd();
    telemetry.seeking(5);
    time = 940;
    telemetry.seeked(20);
    telemetry.updatePosition(20, 100);
    telemetry.quality({ id: "720p", height: 720, bandwidth: 2_000_000 }, 4_000_000);
    telemetry.error(
      new ErrorReporter().capture(
        new PlaybackError("private", {
          code: "NET",
          category: "network",
          fatal: false,
          recoverable: true,
        }),
      ),
    );
    time = 1_240;
    telemetry.paused();
    expect(telemetry.flush()).toBe(false);
    expect(sent).toHaveLength(1);
    const batch = TelemetryBatchSchema.parse(JSON.parse(sent[0]));
    const events = batch.sessions[0].events;
    expect(events.find((event) => event.type === "buffering")).toMatchObject({
      bufferDurationMs: 250,
    });
    expect(events.find((event) => event.type === "seek")).toMatchObject({
      seekFromS: 5,
      seekToS: 20,
      seekLatencyMs: 40,
    });
    expect(events.find((event) => event.type === "quality")).toMatchObject({
      renditionId: "720p",
      bandwidthEstimate: 4_000_000,
    });
    expect(events.find((event) => event.type === "error")).toMatchObject({
      error: { code: "NET" },
    });
    expect(events.at(-1)).toMatchObject({
      type: "session_snapshot",
      startupMs: 150,
      totalBufferMs: 250,
      watchDurationMs: 1090,
      failedRequests: 1,
      completionPercentage: 20,
    });
    expect(JSON.stringify(batch)).not.toContain("private");
    expect(telemetry.flush()).toBe(false);
    expect(sent).toHaveLength(2);
    telemetry.dispose();
  });
  it("keeps tracking watch time after a periodic snapshot", () => {
    let time = 0;
    const sent: string[] = [];
    const telemetry = new TelemetryService(
      () => context,
      { send: (body) => (sent.push(body), true) },
      undefined,
      () => time,
    );
    telemetry.updatePosition(1, 10);
    telemetry.playing();
    time = 500;
    telemetry.flush();
    time = 1_000;
    telemetry.paused();
    telemetry.flush();
    const latest = TelemetryBatchSchema.parse(JSON.parse(sent[1])).sessions[0].events.at(-1);
    expect(latest).toMatchObject({ watchDurationMs: 1_000 });
    telemetry.dispose();
  });
});
