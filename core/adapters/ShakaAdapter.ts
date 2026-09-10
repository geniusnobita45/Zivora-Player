import type shaka from "shaka-player";
import { z } from "zod";
import { TypedEventEmitter, type PlayerEventMap } from "@/core/player/PlayerEvents";
import {
  PlaybackError,
  adapterError,
  type PlaybackErrorCategory,
} from "@/core/player/PlayerErrors";
import {
  createPlayerConfig,
  ManifestUrlSchema,
  PositionSchema,
  VolumeSchema,
  RateSchema,
  TrackIdSchema,
} from "@/core/player/PlayerConfig";
import {
  AdapterLoadOptionsSchema,
  QualitySchema,
  AudioTrackSchema,
  TextTrackSchema,
  type PlaybackAdapter,
  type AdapterLoadOptions,
  type Quality,
  type AudioTrack,
  type TextTrack,
  type BufferedRange,
} from "./PlaybackAdapter";

import type { PlaybackRequestContext, RequestAuthorization } from "@/services/security/PlaybackRequestAuthorization";
import type { TextPresentation, PresentedCue } from "./TextPresentation";
import { TextPresentationBridge } from "./TextPresentationBridge";
export type { PlaybackRequestContext } from "@/services/security/PlaybackRequestAuthorization";
export interface ShakaAdapterOptions {
  textPresentation?: TextPresentation;
  authorizeRequest?: (request: PlaybackRequestContext) => Promise<RequestAuthorization | undefined>;
  /** Called per request so tokens can refresh. Return headers only for trusted URIs. */
  getRequestHeaders?: (
    request: PlaybackRequestContext,
  ) => Promise<Record<string, string> | undefined> | Record<string, string> | undefined;
}

const ShakaErrorSchema = z.object({
  code: z.number().int(),
  category: z.number().int(),
  severity: z.number().int(),
  data: z.array(z.unknown()).optional(),
});
const RequestHeadersSchema = z.record(
  z.string().regex(/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/),
  z.string().refine((value) => !/[\r\n]/.test(value), "Invalid header value"),
);

/** Shaka's numeric codes are normalized here; no SDK error type escapes the adapter. */
export function mapShakaError(cause: unknown): PlaybackError {
  if (cause instanceof PlaybackError) return cause;
  const result = ShakaErrorSchema.safeParse(cause);
  if (!result.success) {
    if (z.object({ name: z.literal("NotAllowedError") }).safeParse(cause).success) {
      return new PlaybackError("Playback requires a user gesture", {
        code: "AUTOPLAY_BLOCKED",
        category: "adapter",
        fatal: false,
        recoverable: false,
        cause,
      });
    }
    return adapterError("SHAKA_ADAPTER_ERROR", "Shaka playback operation failed", cause);
  }
  const { code, category: rawCategory, severity, data } = result.data;
  const categories: Record<number, PlaybackErrorCategory> = {
    1: "network",
    2: "media",
    3: "media",
    4: "manifest",
    5: "media",
    6: "drm",
    7: "adapter",
  };
  const category = categories[rawCategory] ?? "unknown";
  const status = typeof data?.[1] === "number" ? data[1] : 0;
  // Retry transport failures and transient HTTP statuses, never auth/404/parse/DRM failures.
  const transientNetwork =
    [1002, 1003].includes(code) ||
    (code === 1001 && (status === 408 || status === 429 || status >= 500));
  const recoverable =
    transientNetwork ||
    (severity === 1 && !["drm", "manifest", "adapter", "network"].includes(category));
  return new PlaybackError(`Shaka playback error ${code}`, {
    code: `SHAKA_${code}`,
    category,
    fatal: severity === 2,
    recoverable,
    cause,
  });
}

/** HLS/CMAF is loaded directly by Shaka's browser networking stack. No media proxy. */
export class ShakaAdapter extends TypedEventEmitter<PlayerEventMap> implements PlaybackAdapter {
  private player: shaka.Player | null = null;
  private initialization: Promise<shaka.Player> | null = null;
  private destruction: Promise<void> | null = null;
  private disposed = false;
  private loading = false;
  private loaded = false;
  private loadError: PlaybackError | null = null;
  private buffering = false;
  private automatic = true;
  private readonly removeListeners: (() => void)[] = [];

  constructor(
    private readonly video: HTMLVideoElement,
    private readonly options: ShakaAdapterOptions = {},
  ) {
    super();
  }

  private assertAlive(): void {
    if (this.disposed) throw adapterError("ADAPTER_DESTROYED", "Adapter has been destroyed");
  }
  private requirePlayer(): shaka.Player {
    this.assertAlive();
    if (!this.player || !this.loaded)
      throw adapterError("NOT_READY", "Load media before using the adapter");
    return this.player;
  }
  private listen(
    target: Pick<EventTarget, "addEventListener" | "removeEventListener">,
    type: string,
    callback: (event: Event) => void,
  ): void {
    const listener = (event: Event) => {
      if (this.disposed) return;
      try {
        callback(event);
      } catch (cause) {
        this.handleError(cause);
      }
    };
    target.addEventListener(type, listener);
    this.removeListeners.push(() => target.removeEventListener(type, listener));
  }
  private handleError(cause: unknown): void {
    const error = mapShakaError(cause);
    if (this.loading) this.loadError = error;
    else this.emit("error", error);
  }
  private initialize(): Promise<shaka.Player> {
    this.assertAlive();
    if (this.initialization) return this.initialization;
    this.initialization = (async () => {
      // No browser globals or SDK execution at module evaluation or construction time.
      const { default: sdk } = await import("shaka-player");
      this.assertAlive();
      sdk.polyfill.installAll();
      if (!sdk.Player.isBrowserSupported())
        throw adapterError("UNSUPPORTED_BROWSER", "This browser cannot play adaptive media");
      const player = new sdk.Player();
      this.player = player;
      await player.attach(this.video);
      if (this.options.textPresentation) {
        const video = this.video;
        const output = this.options.textPresentation;
        player.configure({
          textDisplayFactory: () => {
            const native = new sdk.text.SimpleTextDisplayer(video, "Zivora captions");
            const bridge = new TextPresentationBridge(output, (visible) =>
              native.setTextVisibility(visible),
            );
            const update = () =>
              bridge.update(
                video.currentTime,
                video.ownerDocument.pictureInPictureElement === video,
              );
            const timer = setInterval(update, 100);
            video.addEventListener("timeupdate", update);
            video.addEventListener("seeked", update);
            let customFailed = false;
            const text = (cue: shaka.text.Cue): string =>
              cue.lineBreak
                ? "\n"
                : cue.nestedCues.length
                  ? cue.nestedCues.map(text).join("")
                  : cue.payload;
            return {
              append(cues: shaka.text.Cue[]) {
                native.append(cues);
                if (!customFailed)
                  try {
                    const metadata = z
                      .object({
                        speaker: z.string().max(200).optional(),
                        hint: z.string().max(1000).optional(),
                      })
                      .strict();
                    bridge.append(
                      cues.map((cue): PresentedCue => ({
                        id: cue.id,
                        start: cue.startTime,
                        end: cue.endTime,
                        text: text(cue),
                        ...(cue.id.startsWith("zivora:")
                          ? metadata.parse(JSON.parse(decodeURIComponent(cue.id.slice(7))))
                          : {}),
                      })),
                    );
                  } catch {
                    customFailed = true;
                    bridge.destroy();
                    native.setTextVisibility(bridge.isVisible());
                  }
                update();
              },
              remove(start: number, end: number) {
                bridge.remove(start, end);
                update();
                return native.remove(start, end);
              },
              isTextVisible() {
                return bridge.isVisible();
              },
              setTextVisibility(visible: boolean) {
                bridge.setVisible(visible);
                if (customFailed) native.setTextVisibility(visible);
                else update();
              },
              setTextLanguage(language: string) {
                native.setTextLanguage(language);
              },
              configure(config: shaka.extern.TextDisplayerConfiguration) {
                native.configure(config);
              },
              enableTextDisplayer() {
                native.enableTextDisplayer();
              },
              async destroy() {
                clearInterval(timer);
                video.removeEventListener("timeupdate", update);
                video.removeEventListener("seeked", update);
                bridge.destroy();
                await native.destroy();
              },
            };
          },
        });
      }
      this.assertAlive();
      const networking = player.getNetworkingEngine();
      if (!networking)
        throw adapterError("NETWORK_ENGINE_UNAVAILABLE", "Shaka networking is unavailable");
      const filter: shaka.extern.RequestFilter = async (type, request) => {
        this.assertAlive();
        const uris = z.array(ManifestUrlSchema).min(1).parse(request.uris);
        const types = sdk.net.NetworkingEngine.RequestType;
        const kind =
          type === types.MANIFEST
            ? "manifest"
            : type === types.SEGMENT
              ? "segment"
              : type === types.LICENSE
                ? "license"
                : "other";
        const authorized = await this.options.authorizeRequest?.({ type: kind, uris });
        this.assertAlive();
        if (authorized)
          request.uris = z
            .object({ uris: z.array(ManifestUrlSchema).min(1).max(64) })
            .strict()
            .parse(authorized).uris;
        const headers = await this.options.getRequestHeaders?.({ type: kind, uris: request.uris });
        this.assertAlive();
        if (headers) Object.assign(request.headers, RequestHeadersSchema.parse(headers));
      };
      networking.registerRequestFilter(filter);
      this.removeListeners.push(() => networking.unregisterRequestFilter(filter));
      this.listen(player, "error", (event) =>
        this.handleError(z.object({ detail: z.unknown() }).parse(event).detail),
      );
      this.listen(player, "buffering", (event) => {
        const { buffering } = z.object({ buffering: z.boolean() }).parse(event);
        if (this.loading || buffering === this.buffering) return;
        this.buffering = buffering;
        this.emit(buffering ? "bufferingstart" : "bufferingend", undefined);
      });
      for (const type of ["adaptation", "variantchanged", "trackschanged"])
        this.listen(player, type, () => {
          if (this.loaded && !this.loading) this.emitTracks();
        });
      for (const type of ["textchanged", "texttrackvisibility"])
        this.listen(player, type, () => {
          if (this.loaded && !this.loading) this.emitText();
        });
      this.listen(this.video, "playing", () => {
        if (!this.loading && this.loaded) this.emit("playing", undefined);
      });
      this.listen(this.video, "pause", () => {
        if (!this.loading && this.loaded && !this.video.ended) this.emit("paused", undefined);
      });
      this.listen(this.video, "ended", () => {
        if (!this.loading && this.loaded) this.emit("ended", undefined);
      });
      this.listen(this.video, "timeupdate", () => {
        if (!this.loading && this.loaded) this.emit("timeupdate", this.timing());
      });
      this.listen(this.video, "durationchange", () => {
        if (!this.loading && this.loaded) this.emit("timeupdate", this.timing());
      });
      this.listen(this.video, "seeking", () => {
        if (!this.loading && this.loaded)
          this.emit("seeking", { position: this.timing().position });
      });
      this.listen(this.video, "seeked", () => {
        if (!this.loading && this.loaded) this.emit("seeked", { position: this.timing().position });
      });
      this.listen(this.video, "ratechange", () => {
        // Shaka's PlayRateController uses zero internally while buffering/seeking.
        // It is not a user speed and must not replace the engine's requested rate.
        const rate = z.number().finite().parse(this.video.playbackRate);
        if (rate === 0) return;
        this.emit("ratechange", { rate: RateSchema.parse(rate) });
      });
      this.listen(this.video, "volumechange", () =>
        this.emit("volumechange", {
          volume: VolumeSchema.parse(this.video.volume),
          muted: z.boolean().parse(this.video.muted),
        }),
      );
      return player;
    })().catch(async (cause: unknown) => {
      this.removeListeners.splice(0).forEach((remove) => remove());
      const player = this.player;
      this.player = null;
      this.initialization = null;
      await player?.destroy();
      throw mapShakaError(cause);
    });
    return this.initialization;
  }

  private timing(): { position: number; duration: number } {
    return {
      position: PositionSchema.parse(this.video.currentTime),
      duration: Number.isFinite(this.video.duration)
        ? PositionSchema.parse(this.video.duration)
        : 0,
    };
  }
  async load(manifestUrl: string, input: AdapterLoadOptions = {}): Promise<void> {
    this.assertAlive();
    const url = ManifestUrlSchema.parse(manifestUrl);
    const options = AdapterLoadOptionsSchema.parse(input);
    const config = options.config ?? createPlayerConfig();
    const start = options.startPosition ?? config.startupPosition;
    if (this.loading)
      throw adapterError("LOAD_IN_PROGRESS", "An adapter load is already in progress");
    this.loading = true;
    this.loaded = false;
    this.loadError = null;
    this.buffering = false;
    try {
      const player = await this.initialize();
      this.assertAlive();
      this.automatic = config.abr.enabled;
      const configured = player.configure({
        abr: config.abr,
        streaming: {
          ...config.buffer,
          retryParameters: config.retry,
          preferNativeHls: false,
          useNativeHlsForFairPlay: false,
        },
        manifest: { retryParameters: config.retry },
        drm: { retryParameters: config.retry },
      });
      if (!configured)
        throw adapterError("INVALID_CONFIGURATION", "Shaka rejected the playback configuration");
      await player.load(url, start);
      this.assertAlive();
      if (this.loadError) throw this.loadError;
      this.loaded = true;
      this.emit("manifestloaded", { manifestUrl: url });
      this.emit("ready", this.timing());
      this.emitTracks();
      this.emitText();
    } catch (cause) {
      throw mapShakaError(cause);
    } finally {
      this.loading = false;
    }
  }
  async play(): Promise<void> {
    this.requirePlayer();
    try {
      await this.video.play();
    } catch (cause) {
      throw mapShakaError(cause);
    }
  }
  async pause(): Promise<void> {
    this.requirePlayer();
    this.video.pause();
  }
  async seek(position: number): Promise<void> {
    const player = this.requirePlayer();
    const target = PositionSchema.parse(position);
    const range = z
      .object({ start: PositionSchema, end: PositionSchema })
      .parse(player.seekRange());
    this.video.currentTime = Math.max(range.start, Math.min(target, range.end));
  }
  async setVolume(volume: number): Promise<void> {
    this.requirePlayer();
    this.video.volume = VolumeSchema.parse(volume);
  }
  async setMuted(muted: boolean): Promise<void> {
    this.requirePlayer();
    this.video.muted = z.boolean().parse(muted);
  }
  async setRate(rate: number): Promise<void> {
    this.requirePlayer();
    this.video.playbackRate = RateSchema.parse(rate);
  }
  getQualities(): Quality[] {
    return z.array(QualitySchema).parse(
      (this.player?.getVariantTracks() ?? []).map((track) => ({
        id: String(track.id),
        width: track.width ?? 0,
        height: track.height ?? 0,
        bandwidth: track.bandwidth,
        codecs: track.codecs ?? "",
        active: track.active,
      })),
    );
  }
  async selectQuality(id: string): Promise<void> {
    const player = this.requirePlayer();
    TrackIdSchema.parse(id);
    if (id === "auto") {
      this.automatic = true;
      player.configure({ abr: { enabled: true } });
    } else {
      const track = player.getVariantTracks().find((track) => String(track.id) === id);
      if (!track) throw adapterError("TRACK_NOT_FOUND", "Quality not found");
      this.automatic = false;
      player.configure({ abr: { enabled: false } });
      player.selectVariantTrack(track, true);
    }
    this.emitTracks();
  }
  getAudioTracks(): AudioTrack[] {
    const tracks = this.player?.getVariantTracks() ?? [];
    const result = new Map<string, AudioTrack>();
    for (const track of tracks) {
      if (track.audioId == null) continue;
      const id = String(track.audioId);
      const previous = result.get(id);
      result.set(id, {
        id,
        language: track.language,
        label: track.label ?? track.language,
        roles: [...(track.audioRoles ?? [])],
        active: Boolean(previous?.active || track.active),
      });
    }
    return z.array(AudioTrackSchema).parse([...result.values()]);
  }
  async selectAudio(id: string): Promise<void> {
    const player = this.requirePlayer();
    TrackIdSchema.parse(id);
    const tracks = player.getVariantTracks();
    const active = tracks.find((track) => track.active);
    const candidates = tracks.filter(
      (track) => track.audioId != null && String(track.audioId) === id,
    );
    const track = candidates.find((track) => track.height === active?.height) ?? candidates[0];
    if (!track) throw adapterError("TRACK_NOT_FOUND", "Audio track not found");
    player.selectAudioLanguage(
      track.language,
      track.audioRoles?.[0],
      track.channelsCount ?? undefined,
    );
    player.selectVariantTrack(track, true);
    this.emitTracks();
  }
  getTextTracks(): TextTrack[] {
    return z.array(TextTrackSchema).parse(
      (this.player?.getTextTracks() ?? []).map((track) => ({
        id: String(track.id),
        language: track.language,
        label: track.label ?? track.language,
        kind: /\[(original|literal|natural)\]$/.exec(track.label ?? "")?.[1] ?? "original",
        active: track.active && Boolean(this.player?.isTextTrackVisible()),
      })),
    );
  }
  async selectText(id: string | null): Promise<void> {
    const player = this.requirePlayer();
    TrackIdSchema.nullable().parse(id);
    if (id === null) player.setTextTrackVisibility(false);
    else {
      const track = player.getTextTracks().find((track) => String(track.id) === id);
      if (!track) throw adapterError("TRACK_NOT_FOUND", "Text track not found");
      player.selectTextTrack(track);
      player.setTextTrackVisibility(true);
    }
    this.emitText();
  }
  private emitTracks(): void {
    this.emit("qualitychange", {
      quality: this.getQualities().find((track) => track.active) ?? null,
      automatic: this.automatic,
    });
    this.emit("audiochange", {
      track: this.getAudioTracks().find((track) => track.active) ?? null,
    });
  }
  private emitText(): void {
    this.emit("textchange", { track: this.getTextTracks().find((track) => track.active) ?? null });
  }
  getBufferedRanges(): BufferedRange[] {
    if (this.disposed) return [];
    return Array.from({ length: this.video.buffered.length }, (_, index) =>
      z
        .object({ start: PositionSchema, end: PositionSchema })
        .parse({ start: this.video.buffered.start(index), end: this.video.buffered.end(index) }),
    );
  }
  getBandwidthEstimate(): number {
    const estimate = this.player?.getStats().estimatedBandwidth;
    return typeof estimate === "number" && Number.isFinite(estimate) && estimate >= 0
      ? estimate
      : 0;
  }
  destroy(): Promise<void> {
    if (this.destruction) return this.destruction;
    this.disposed = true;
    this.loaded = false;
    this.removeListeners.splice(0).forEach((remove) => remove());
    this.destruction = (async () => {
      await this.initialization?.catch(() => {});
      const player = this.player;
      this.player = null;
      try {
        await player?.destroy();
      } finally {
        this.emit("destroyed", undefined);
        this.clear();
      }
    })();
    return this.destruction;
  }
}
