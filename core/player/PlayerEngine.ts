import type { PlaybackAdapter } from "@/core/adapters/PlaybackAdapter";
import { z } from "zod";
import { PlayerCommandSchema, SkipSegmentSchema, type SkipSegment } from "./PlayerCommand";
import { clampSeek } from "./PlayerCommandValidator";
import { QualityManager } from "@/core/streaming/QualityManager";
import { TrackManager, type PreferenceStorage } from "@/core/streaming/TrackManager";
import { BufferMonitor } from "@/core/streaming/BufferMonitor";
import { presentationUnavailable, type PlayerPresentation } from "./PlayerPresentation";
import {
  createPlayerConfig,
  ManifestUrlSchema,
  PositionSchema,
  type PlayerConfigInput,
} from "./PlayerConfig";
import { PlaybackError, adapterError, toPlaybackError } from "./PlayerErrors";
import {
  TypedEventEmitter,
  type PlayerEventMap,
  type PlayerEventName,
  type PlayerEventListener,
} from "./PlayerEvents";

export type PlayerState =
  "idle" | "loading" | "ready" | "playing" | "paused" | "buffering" | "ended" | "error";
export interface PlayerSnapshot {
  state: PlayerState;
  manifestUrl: string | null;
  position: number;
  duration: number;
  paused: boolean;
  seeking: boolean;
  volume: number;
  muted: boolean;
  rate: number;
  qualityId: string | "auto";
  audioTrackId: string | null;
  textTrackId: string | null;
  recoveryAttempts: number;
  error: PlaybackError | null;
  destroyed: boolean;
}

const transitions: Record<PlayerState, readonly PlayerState[]> = {
  idle: ["loading", "error"],
  loading: ["ready", "error", "idle"],
  ready: ["playing", "paused", "buffering", "ended", "loading", "error", "idle"],
  playing: ["paused", "buffering", "ended", "loading", "error", "idle"],
  paused: ["playing", "buffering", "ended", "loading", "error", "idle"],
  buffering: ["playing", "paused", "ready", "ended", "loading", "error", "idle"],
  ended: ["playing", "paused", "loading", "error", "idle"],
  error: ["loading", "idle"],
};

/** Single owner of one adapter. Operations are serialized; obsolete loads cannot mutate state. */
export class PlayerEngine {
  private readonly events = new TypedEventEmitter<PlayerEventMap>();
  private readonly qualities = new QualityManager();
  private readonly tracks: TrackManager;
  private readonly buffer = new BufferMonitor();
  private skipSegments: SkipSegment[] = [];
  private pendingManifestUrl: string | null = null;
  private readonly config;
  private readonly unsubscribe: (() => void)[] = [];
  private queue: Promise<void> = Promise.resolve();
  private epoch = 0;
  private activeEpoch = 0;
  private loading = false;
  private executing = false;
  private commandError: PlaybackError | null = null;
  private loadError: PlaybackError | null = null;
  private recoveryQueued = false;
  private wantedPlaying = false;
  private bufferReturnState: PlayerState = "ready";
  private destroyPromise: Promise<void> | null = null;
  private snapshot: PlayerSnapshot = {
    state: "idle",
    manifestUrl: null,
    position: 0,
    duration: 0,
    paused: true,
    seeking: false,
    volume: 1,
    muted: false,
    rate: 1,
    qualityId: "auto",
    audioTrackId: null,
    textTrackId: null,
    recoveryAttempts: 0,
    error: null,
    destroyed: false,
  };

  constructor(
    private adapter: PlaybackAdapter,
    config: PlayerConfigInput = {},
    private readonly options: {
      presentation?: PlayerPresentation;
      trackStorage?: PreferenceStorage | null;
    } = {},
  ) {
    this.config = createPlayerConfig(config);
    this.tracks = new TrackManager(options.trackStorage);
    this.bindAdapter();
  }

  getSnapshot(): Readonly<PlayerSnapshot> {
    return Object.freeze({ ...this.snapshot });
  }
  getCommandContext() {
    return {
      position: this.snapshot.position,
      duration: this.snapshot.duration,
      skipSegments: this.skipSegments.map((segment) => ({ ...segment })),
    };
  }
  setSkipSegments(input: unknown): void {
    const segments = z.array(SkipSegmentSchema).parse(input);
    if (new Set(segments.map((segment) => segment.id)).size !== segments.length)
      throw new Error("Duplicate skip segment IDs");
    this.skipSegments = segments;
  }
  getStreamingSnapshot() {
    return {
      quality: this.qualities.getSnapshot(),
      tracks: this.tracks.getSnapshot(),
      buffer: this.buffer.getSnapshot(),
      bufferedRanges: this.buffer.getBufferedRanges(),
      bandwidthSamples: this.buffer.getBandwidthSamples(),
    };
  }
  updateManifestUrl(url: string): void {
    this.assertAlive();
    const next = new URL(ManifestUrlSchema.parse(url));
    const target = this.pendingManifestUrl ?? this.snapshot.manifestUrl;
    const previous = target ? new URL(target) : null;
    if (!previous || next.origin !== previous.origin || next.pathname !== previous.pathname)
      throw new Error("Manifest renewal must retain the immutable media path");
    if (this.pendingManifestUrl !== null) this.pendingManifestUrl = url;
    else this.snapshot.manifestUrl = url;
  }
  on<K extends PlayerEventName>(type: K, listener: PlayerEventListener<K>): () => void {
    return this.events.on(type, listener);
  }
  off<K extends PlayerEventName>(type: K, listener: PlayerEventListener<K>): void {
    this.events.off(type, listener);
  }

  load(manifestUrl: string, startPosition = this.config.startupPosition): Promise<void> {
    this.assertAlive();
    const url = ManifestUrlSchema.parse(manifestUrl);
    const position = PositionSchema.parse(startPosition);
    const epoch = ++this.epoch;
    this.pendingManifestUrl = url;
    this.wantedPlaying = this.config.autoplay;
    return this.enqueue(async () => {
      this.assertCurrent(epoch);
      this.skipSegments = [];
      this.qualities.reset();
      this.buffer.stop();
      this.buffer.reset();
      this.snapshot = {
        ...this.snapshot,
        manifestUrl: this.pendingManifestUrl ?? url,
        position,
        duration: 0,
        recoveryAttempts: 0,
        error: null,
        seeking: false,
        paused: true,
        qualityId: "auto",
        audioTrackId: null,
        textTrackId: null,
      };
      this.pendingManifestUrl = null;
      try {
        await this.loadOnce(epoch);
      } catch (cause) {
        this.assertCurrent(epoch);
        await this.recover(toPlaybackError(cause), epoch);
      }
    });
  }

  /** Factory is invoked only after the previous adapter is destroyed (safe for one video element). */
  swapAdapter(createAdapter: () => PlaybackAdapter): Promise<void> {
    this.assertAlive();
    this.pendingManifestUrl = null;
    const epoch = ++this.epoch;
    return this.enqueue(async () => {
      try {
        this.assertAlive();
        this.unbindAdapter();
        await this.adapter.destroy();
        this.assertAlive();
        this.adapter = createAdapter();
        this.activeEpoch = epoch;
        this.bindAdapter();
        // A later load still needs the replacement, but supersedes session restoration.
        if (epoch !== this.epoch) return;
        if (this.snapshot.manifestUrl) {
          try {
            await this.loadOnce(epoch);
          } catch (cause) {
            this.assertCurrent(epoch);
            await this.recover(toPlaybackError(cause), epoch);
          }
        } else this.setState("idle");
      } catch (cause) {
        this.assertCurrent(epoch);
        this.fail(toPlaybackError(cause));
        throw cause;
      }
    });
  }

  /** @internal Application actions enter through PlayerController.dispatch. */
  execute(input: unknown): Promise<void> {
    this.assertAlive();
    const command = PlayerCommandSchema.parse(input);
    if (command.type === "TOGGLE_FULLSCREEN" || command.type === "TOGGLE_PIP") {
      return (async () => {
        if (!this.options.presentation) throw presentationUnavailable();
        try {
          if (command.type === "TOGGLE_FULLSCREEN")
            await this.options.presentation.toggleFullscreen();
          else await this.options.presentation.togglePictureInPicture();
        } catch (cause) {
          throw new PlaybackError("Presentation request failed", {
            code: "PRESENTATION_FAILED",
            category: "adapter",
            fatal: false,
            recoverable: false,
            cause,
          });
        }
      })();
    }
    // Capture intent immediately so pause during recovery cannot autoplay on reload.
    if (command.type === "PLAY") this.wantedPlaying = true;
    if (command.type === "PAUSE") this.wantedPlaying = false;
    const epoch = this.epoch;
    return this.enqueue(async () => {
      this.assertCurrent(epoch);
      if (["idle", "loading", "error"].includes(this.snapshot.state)) {
        throw adapterError("NOT_READY", "Load media before executing playback commands");
      }
      this.executing = true;
      this.commandError = null;
      try {
        switch (command.type) {
          case "PLAY":
            await this.adapter.play();
            break;
          case "PAUSE":
            await this.adapter.pause();
            break;
          case "TOGGLE_PLAY":
            this.wantedPlaying = this.snapshot.paused;
            if (this.wantedPlaying) await this.adapter.play();
            else await this.adapter.pause();
            break;
          case "SEEK_TO":
            await this.adapter.seek(clampSeek(command.seconds, this.snapshot.duration));
            break;
          case "SEEK_BY":
            await this.adapter.seek(
              clampSeek(this.snapshot.position + command.delta, this.snapshot.duration),
            );
            break;
          case "SKIP_SEGMENT": {
            const segment = this.skipSegments.find((segment) => segment.id === command.segmentId);
            if (!segment)
              throw adapterError(
                "TRACK_NOT_FOUND",
                "Skip segment is not registered for this media",
              );
            await this.adapter.seek(clampSeek(segment.end, this.snapshot.duration));
            break;
          }
          case "SET_VOLUME":
            await this.adapter.setVolume(command.level);
            break;
          case "SET_MUTED":
            await this.adapter.setMuted(command.muted);
            break;
          case "SET_RATE":
            await this.adapter.setRate(command.rate);
            break;
          case "SELECT_QUALITY": {
            this.qualities.setRenditions(this.adapter.getQualities());
            if (!this.qualities.resolve(command.id))
              throw adapterError("TRACK_NOT_FOUND", "Quality not found");
            await this.adapter.selectQuality(command.id);
            break;
          }
          case "ENABLE_AUTO_QUALITY":
            await this.adapter.selectQuality("auto");
            break;
          case "SELECT_AUDIO": {
            this.tracks.setTracks(this.adapter.getAudioTracks(), this.adapter.getTextTracks());
            const track = this.tracks.resolveAudio(command.lang);
            if (!track) throw adapterError("TRACK_NOT_FOUND", "Audio language is unavailable");
            await this.adapter.selectAudio(track.id);
            this.tracks.preferAudio(command.lang);
            break;
          }
          case "SELECT_SUBTITLE": {
            this.tracks.setTracks(this.adapter.getAudioTracks(), this.adapter.getTextTracks());
            const track =
              command.lang === null
                ? null
                : this.tracks.resolveSubtitle(command.lang, command.kind);
            if (command.lang !== null && !track)
              throw adapterError("TRACK_NOT_FOUND", "Subtitle language is unavailable");
            await this.adapter.selectText(track?.id ?? null);
            this.tracks.preferSubtitle(command.lang, command.kind);
            break;
          }
        }
        this.assertCurrent(epoch);
        if (this.commandError) throw this.commandError;
      } catch (cause) {
        this.assertCurrent(epoch);
        const error = toPlaybackError(cause);
        if (error.recoverable) await this.recover(error, epoch);
        else {
          if (error.fatal) this.fail(error);
          else this.report(error);
          throw error;
        }
      } finally {
        this.executing = false;
      }
    });
  }

  destroy(): Promise<void> {
    if (this.destroyPromise) return this.destroyPromise;
    this.snapshot.destroyed = true;
    this.buffer.destroy();
    this.snapshot.paused = true;
    this.snapshot.seeking = false;
    this.wantedPlaying = false;
    ++this.epoch;
    this.unbindAdapter();
    this.setState("idle");
    this.destroyPromise = this.adapter.destroy().finally(() => {
      this.events.emit("destroyed", undefined);
      this.events.clear();
    });
    return this.destroyPromise;
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const result = this.queue.then(operation);
    this.queue = result.catch(() => {});
    return result;
  }
  private assertAlive(): void {
    if (this.snapshot.destroyed)
      throw adapterError("ENGINE_DESTROYED", "Player engine has been destroyed");
  }
  private assertCurrent(epoch: number): void {
    this.assertAlive();
    if (epoch !== this.epoch)
      throw adapterError("OPERATION_CANCELLED", "Playback operation was superseded");
  }
  private setState(state: PlayerState): void {
    if (state === this.snapshot.state || transitions[this.snapshot.state].includes(state))
      this.snapshot.state = state;
  }
  private report(error: PlaybackError): void {
    if (this.snapshot.error !== error) {
      this.snapshot.error = error;
      this.events.emit("error", error);
    }
  }
  private fail(error: PlaybackError): void {
    this.setState("error");
    this.snapshot.paused = true;
    this.snapshot.seeking = false;
    void this.adapter.pause().catch(() => {});
    this.report(error);
  }

  private async loadOnce(epoch: number): Promise<void> {
    this.assertCurrent(epoch);
    this.activeEpoch = epoch;
    this.setState("loading");
    this.buffer.stop();
    this.buffer.reset();
    this.loading = true;
    this.loadError = null;
    this.snapshot.paused = true;
    const { manifestUrl, position, volume, muted, rate, qualityId, audioTrackId, textTrackId } =
      this.snapshot;
    try {
      await this.adapter.load(manifestUrl!, { startPosition: position, config: this.config });
      this.assertCurrent(epoch);
      if (this.loadError) throw this.loadError;
      await this.adapter.setVolume(volume);
      await this.adapter.setMuted(muted);
      await this.adapter.setRate(rate);
      this.assertCurrent(epoch);
      this.qualities.setRenditions(this.adapter.getQualities());
      this.tracks.setTracks(this.adapter.getAudioTracks(), this.adapter.getTextTracks());
      const preferences = this.tracks.getSnapshot().preferences;
      if (qualityId !== "auto" && this.qualities.resolve(qualityId))
        await this.adapter.selectQuality(qualityId);
      const audio = preferences.audioLang
        ? this.tracks.resolveAudio(preferences.audioLang)?.id
        : audioTrackId;
      const text = preferences.subtitleLang
        ? this.tracks.resolveSubtitle(preferences.subtitleLang, preferences.subtitleKind)?.id
        : textTrackId;
      if (audio && this.adapter.getAudioTracks().some((track) => track.id === audio))
        await this.adapter.selectAudio(audio);
      await this.adapter.selectText(
        text && this.adapter.getTextTracks().some((track) => track.id === text) ? text : null,
      );
      this.assertCurrent(epoch);
      if (this.loadError) throw this.loadError;
      this.snapshot.error = null;
      this.setState("ready");
      this.buffer.start(() => ({
        position: this.snapshot.position,
        playing: !this.snapshot.paused,
        seeking: this.snapshot.seeking,
        bufferedRanges: [...this.adapter.getBufferedRanges()],
        bandwidth: this.adapter.getBandwidthEstimate(),
      }));
    } finally {
      this.loading = false;
    }
    if (this.wantedPlaying) await this.adapter.play();
    this.assertCurrent(epoch);
  }

  private async recover(initialError: PlaybackError, epoch: number): Promise<void> {
    let error = initialError;
    while (true) {
      this.assertCurrent(epoch);
      this.report(error);
      this.assertCurrent(epoch);
      if (!error.recoverable || !this.snapshot.manifestUrl) {
        if (error.fatal) this.fail(error);
        throw error;
      }
      if (this.snapshot.recoveryAttempts >= this.config.maxRecoveryAttempts) {
        const exhausted = new PlaybackError("Playback recovery attempts exhausted", {
          code: "RECOVERY_EXHAUSTED",
          category: error.category,
          fatal: true,
          recoverable: false,
          cause: error,
        });
        this.fail(exhausted);
        throw exhausted;
      }
      ++this.snapshot.recoveryAttempts;
      try {
        await this.loadOnce(epoch);
        return;
      } catch (cause) {
        this.assertCurrent(epoch);
        error = toPlaybackError(cause);
      }
    }
  }

  private bindAdapter(): void {
    const adapter = this.adapter;
    const bind = <K extends PlayerEventName>(
      type: K,
      update: (payload: PlayerEventMap[K]) => boolean | void,
    ) => {
      this.unsubscribe.push(
        adapter.on(type, (payload) => {
          if (
            this.snapshot.destroyed ||
            this.adapter !== adapter ||
            this.activeEpoch !== this.epoch
          )
            return;
          if (update(payload) !== false) this.events.emit(type, payload);
        }),
      );
    };
    bind("manifestloaded", () => {});
    bind("ready", (payload) => {
      if (!this.loading) return false;
      this.snapshot.duration = payload.duration;
      this.snapshot.position = payload.position;
      this.setState("ready");
    });
    bind("playing", () => {
      if (this.loading || ["idle", "error"].includes(this.snapshot.state)) return false;
      this.wantedPlaying = true;
      this.snapshot.paused = false;
      this.setState("playing");
    });
    bind("paused", () => {
      if (this.loading || ["idle", "error", "ended"].includes(this.snapshot.state)) return false;
      this.wantedPlaying = false;
      this.snapshot.paused = true;
      this.setState("paused");
    });
    bind("timeupdate", ({ position, duration }) => {
      if (this.loading || ["idle", "error"].includes(this.snapshot.state)) return false;
      this.snapshot.position = position;
      this.snapshot.duration = duration;
    });
    bind("seeking", () => {
      if (this.loading || ["idle", "error"].includes(this.snapshot.state)) return false;
      this.snapshot.seeking = true;
    });
    bind("seeked", ({ position }) => {
      if (this.loading || ["idle", "error"].includes(this.snapshot.state)) return false;
      this.snapshot.position = position;
      this.snapshot.seeking = false;
    });
    bind("bufferingstart", () => {
      if (this.loading || !["ready", "playing", "paused"].includes(this.snapshot.state))
        return false;
      this.bufferReturnState = this.snapshot.state;
      this.setState("buffering");
    });
    bind("bufferingend", () => {
      if (this.loading || this.snapshot.state !== "buffering") return false;
      this.setState(
        this.wantedPlaying ? "playing" : this.bufferReturnState === "ready" ? "ready" : "paused",
      );
    });
    bind("qualitychange", ({ quality, automatic }) => {
      this.qualities.recordChange({ quality, automatic });
      this.snapshot.qualityId = automatic ? "auto" : (quality?.id ?? "auto");
    });
    bind("audiochange", ({ track }) => {
      this.tracks.setTracks(this.adapter.getAudioTracks(), this.adapter.getTextTracks());
      this.snapshot.audioTrackId = track?.id ?? null;
    });
    bind("textchange", ({ track }) => {
      this.tracks.setTracks(this.adapter.getAudioTracks(), this.adapter.getTextTracks());
      this.snapshot.textTrackId = track?.id ?? null;
    });
    bind("ratechange", ({ rate }) => {
      this.snapshot.rate = rate;
    });
    bind("volumechange", ({ volume, muted }) => {
      this.snapshot.volume = volume;
      this.snapshot.muted = muted;
    });
    bind("ended", () => {
      if (this.loading || ["idle", "error"].includes(this.snapshot.state)) return false;
      this.wantedPlaying = false;
      this.snapshot.paused = true;
      this.setState("ended");
    });
    bind("error", (error) => {
      if (this.loading) {
        this.loadError = error;
        return false;
      }
      if (this.executing) {
        this.commandError = error;
        return false;
      }
      if (this.recoveryQueued || this.snapshot.state === "error") return false;
      if (!error.recoverable) {
        if (error.fatal) this.fail(error);
        else this.report(error);
        return false;
      }
      const epoch = this.epoch;
      this.recoveryQueued = true;
      void this.enqueue(() => this.recover(error, epoch))
        .catch(() => {})
        .finally(() => {
          this.recoveryQueued = false;
        });
      return false;
    });
    bind("destroyed", () => {
      this.fail(adapterError("ADAPTER_DESTROYED", "Active adapter was destroyed unexpectedly"));
      return false;
    });
  }
  private unbindAdapter(): void {
    this.unsubscribe.splice(0).forEach((unsubscribe) => unsubscribe());
  }
}
