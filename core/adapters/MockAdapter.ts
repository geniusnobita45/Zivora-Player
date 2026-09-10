import { z } from "zod";
import { TypedEventEmitter, type PlayerEventMap } from "@/core/player/PlayerEvents";
import { adapterError } from "@/core/player/PlayerErrors";
import {
  ManifestUrlSchema,
  PositionSchema,
  VolumeSchema,
  RateSchema,
  TrackIdSchema,
} from "@/core/player/PlayerConfig";
import {
  AdapterLoadOptionsSchema,
  type PlaybackAdapter,
  type AdapterLoadOptions,
  type Quality,
  type AudioTrack,
  type TextTrack,
  type BufferedRange,
} from "./PlaybackAdapter";

/** Deterministic, timer-free adapter. Tests can subclass load or emit typed events. */
export class MockAdapter extends TypedEventEmitter<PlayerEventMap> implements PlaybackAdapter {
  readonly loads: { manifestUrl: string; startPosition: number }[] = [];
  readonly loadFailures: unknown[] = [];
  duration = 7_200;
  position = 0;
  volume = 1;
  muted = false;
  rate = 1;
  playing = false;
  destroyed = false;
  destroyCalls = 0;
  bandwidthEstimate = 1_000_000;
  bufferedRanges: BufferedRange[] = [];
  qualities: Quality[] = [
    { id: "720", width: 1280, height: 720, bandwidth: 1_000_000, codecs: "avc1", active: true },
  ];
  audioTracks: AudioTrack[] = [
    { id: "en", language: "en", label: "English", roles: [], active: true },
  ];
  textTracks: TextTrack[] = [
    { id: "en", language: "en", label: "English", kind: "subtitles", active: false },
  ];

  private assertAlive(): void {
    if (this.destroyed) throw adapterError("ADAPTER_DESTROYED", "Adapter has been destroyed");
  }
  async load(manifestUrl: string, input: AdapterLoadOptions = {}): Promise<void> {
    this.assertAlive();
    const options = AdapterLoadOptionsSchema.parse(input);
    const startPosition = options.startPosition ?? options.config?.startupPosition ?? 0;
    this.loads.push({ manifestUrl: ManifestUrlSchema.parse(manifestUrl), startPosition });
    if (this.loadFailures.length) throw this.loadFailures.shift();
    this.playing = false;
    this.position = Math.min(startPosition, this.duration);
    this.emit("manifestloaded", { manifestUrl });
    this.emit("ready", { duration: this.duration, position: this.position });
  }
  async play(): Promise<void> {
    this.assertAlive();
    this.playing = true;
    this.emit("playing", undefined);
  }
  async pause(): Promise<void> {
    this.assertAlive();
    this.playing = false;
    this.emit("paused", undefined);
  }
  async seek(position: number): Promise<void> {
    this.assertAlive();
    this.position = Math.min(PositionSchema.parse(position), this.duration);
    this.emit("seeking", { position: this.position });
    this.emit("seeked", { position: this.position });
    this.tick(this.position);
  }
  tick(position: number): void {
    this.assertAlive();
    this.position = Math.min(PositionSchema.parse(position), this.duration);
    this.emit("timeupdate", { position: this.position, duration: this.duration });
  }
  async setVolume(volume: number): Promise<void> {
    this.assertAlive();
    this.volume = VolumeSchema.parse(volume);
    this.emit("volumechange", { volume: this.volume, muted: this.muted });
  }
  async setMuted(muted: boolean): Promise<void> {
    this.assertAlive();
    this.muted = z.boolean().parse(muted);
    this.emit("volumechange", { volume: this.volume, muted: this.muted });
  }
  async setRate(rate: number): Promise<void> {
    this.assertAlive();
    this.rate = RateSchema.parse(rate);
    this.emit("ratechange", { rate });
  }
  getQualities(): Quality[] {
    return this.qualities.map((track) => ({ ...track }));
  }
  async selectQuality(id: string): Promise<void> {
    this.assertAlive();
    TrackIdSchema.parse(id);
    if (id !== "auto" && !this.qualities.some((track) => track.id === id))
      throw adapterError("TRACK_NOT_FOUND", "Quality not found");
    if (id !== "auto")
      this.qualities.forEach((track) => {
        track.active = track.id === id;
      });
    this.emit("qualitychange", {
      quality: this.getQualities().find((track) => track.active) ?? null,
      automatic: id === "auto",
    });
  }
  getAudioTracks(): AudioTrack[] {
    return this.audioTracks.map((track) => ({ ...track, roles: [...track.roles] }));
  }
  async selectAudio(id: string): Promise<void> {
    this.assertAlive();
    TrackIdSchema.parse(id);
    if (!this.audioTracks.some((track) => track.id === id))
      throw adapterError("TRACK_NOT_FOUND", "Audio track not found");
    this.audioTracks.forEach((track) => {
      track.active = track.id === id;
    });
    this.emit("audiochange", {
      track: this.getAudioTracks().find((track) => track.active) ?? null,
    });
  }
  getTextTracks(): TextTrack[] {
    return this.textTracks.map((track) => ({ ...track }));
  }
  async selectText(id: string | null): Promise<void> {
    this.assertAlive();
    TrackIdSchema.nullable().parse(id);
    if (id !== null && !this.textTracks.some((track) => track.id === id))
      throw adapterError("TRACK_NOT_FOUND", "Text track not found");
    this.textTracks.forEach((track) => {
      track.active = track.id === id;
    });
    this.emit("textchange", { track: this.getTextTracks().find((track) => track.active) ?? null });
  }
  getBufferedRanges(): BufferedRange[] {
    return this.bufferedRanges.map((range) => ({ ...range }));
  }
  getBandwidthEstimate(): number {
    return this.bandwidthEstimate;
  }
  async destroy(): Promise<void> {
    if (this.destroyed) return;
    this.destroyCalls++;
    this.destroyed = true;
    this.playing = false;
    this.emit("destroyed", undefined);
    this.clear();
  }
}
