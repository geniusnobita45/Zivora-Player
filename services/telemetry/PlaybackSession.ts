import type { PlayerController } from "@/core/player/PlayerController";
import { ErrorReporter } from "./ErrorReporter";
import {
  TelemetryService,
  browserTelemetryDimensions,
  type TelemetryTransport,
} from "./TelemetryService";
import type { TelemetryContext } from "@/types/telemetry";

export interface PlaybackTelemetryContext {
  sessionId: () => string | null;
  contentId: string;
  episodeId: string | null;
  userId: string | null;
  mediaVersionId: () => string | null;
}

/** Optional observer: tracker/transport failures never reach playback. */
export function attachPlaybackTelemetry(
  controller: PlayerController,
  context: PlaybackTelemetryContext | string,
  transport?: TelemetryTransport | ((body: string) => boolean | Promise<unknown>),
) {
  const legacy = typeof context === "string";
  const legacySessionId = globalThis.crypto.randomUUID();
  const details: PlaybackTelemetryContext = legacy
    ? {
        sessionId: () => legacySessionId,
        contentId: context,
        episodeId: null,
        userId: null,
        mediaVersionId: () => null,
      }
    : context;
  const reporter = new ErrorReporter();
  const beaconTransport: TelemetryTransport | undefined =
    typeof transport === "function"
      ? {
          send: (body) => {
            try {
              const result = transport(body);
              if (typeof result === "boolean") return result;
              void Promise.resolve(result).catch(() => undefined);
              return true;
            } catch {
              return false;
            }
          },
        }
      : transport;
  const telemetry = new TelemetryService(
    (): TelemetryContext => ({
      sessionId: details.sessionId() ?? legacySessionId,
      contentId: details.contentId,
      episodeId: details.episodeId,
      userId: details.userId,
      mediaVersionId: details.mediaVersionId(),
      ...browserTelemetryDimensions(),
    }),
    beaconTransport,
  );
  telemetry.start();
  const onPageHide = () => {
    telemetry.flush();
  };
  if (typeof window !== "undefined") window.addEventListener("pagehide", onPageHide);
  const off = [
    controller.on("ready", (event) => {
      telemetry.updatePosition(event.position, event.duration);
      telemetry.ready();
    }),
    controller.on("playing", () => telemetry.playing()),
    controller.on("paused", () => telemetry.paused()),
    controller.on("timeupdate", (event) =>
      telemetry.updatePosition(event.position, event.duration),
    ),
    controller.on("seeking", (event) => telemetry.seeking(event.position)),
    controller.on("seeked", (event) => telemetry.seeked(event.position)),
    controller.on("bufferingstart", () => telemetry.bufferingStart()),
    controller.on("bufferingend", () => telemetry.bufferingEnd()),
    controller.on("qualitychange", (event) =>
      telemetry.quality(event.quality, controller.getStreamingSnapshot().buffer.bandwidth),
    ),
    controller.on("error", (error) => telemetry.error(reporter.capture(error))),
    controller.on("ended", () => telemetry.ended()),
    controller.on("destroyed", () => telemetry.dispose()),
  ];
  return () => {
    off.forEach((unsubscribe) => unsubscribe());
    if (typeof window !== "undefined") window.removeEventListener("pagehide", onPageHide);
    telemetry.dispose();
  };
}
