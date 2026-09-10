import { z } from "zod";
import { PlayerConfigSchema, PositionSchema } from "@/core/player/PlayerConfig";
import type { PlayerEventListener, PlayerEventName } from "@/core/player/PlayerEvents";

export interface Quality {
  id: string;
  width: number;
  height: number;
  bandwidth: number;
  codecs: string;
  active: boolean;
}
export interface AudioTrack {
  id: string;
  language: string;
  label: string;
  roles: readonly string[];
  active: boolean;
}
export interface TextTrack {
  id: string;
  language: string;
  label: string;
  kind: string;
  active: boolean;
}
export interface BufferedRange {
  start: number;
  end: number;
}
export const QualitySchema = z.object({
  id: z.string().min(1),
  width: PositionSchema,
  height: PositionSchema,
  bandwidth: PositionSchema,
  codecs: z.string(),
  active: z.boolean(),
});
export const AudioTrackSchema = z.object({
  id: z.string().min(1),
  language: z.string(),
  label: z.string(),
  roles: z.array(z.string()),
  active: z.boolean(),
});
export const TextTrackSchema = z.object({
  id: z.string().min(1),
  language: z.string(),
  label: z.string(),
  kind: z.string(),
  active: z.boolean(),
});
export const AdapterLoadOptionsSchema = z
  .object({
    startPosition: PositionSchema.optional(),
    config: PlayerConfigSchema.optional(),
  })
  .strict();
export type AdapterLoadOptions = z.input<typeof AdapterLoadOptionsSchema>;

/** Implementations expose only neutral types, never the underlying player instance. */
export interface PlaybackAdapter {
  load(manifestUrl: string, options?: AdapterLoadOptions): Promise<void>;
  play(): Promise<void>;
  pause(): Promise<void>;
  seek(position: number): Promise<void>;
  setVolume(volume: number): Promise<void>;
  setMuted(muted: boolean): Promise<void>;
  setRate(rate: number): Promise<void>;
  getQualities(): readonly Quality[];
  selectQuality(id: string | "auto"): Promise<void>;
  getAudioTracks(): readonly AudioTrack[];
  selectAudio(id: string): Promise<void>;
  getTextTracks(): readonly TextTrack[];
  selectText(id: string | null): Promise<void>;
  getBufferedRanges(): readonly BufferedRange[];
  getBandwidthEstimate(): number;
  destroy(): Promise<void>;
  on<K extends PlayerEventName>(type: K, listener: PlayerEventListener<K>): () => void;
  off<K extends PlayerEventName>(type: K, listener: PlayerEventListener<K>): void;
}
