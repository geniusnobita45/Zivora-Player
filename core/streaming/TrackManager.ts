import { z } from "zod";
import {
  AudioTrackSchema,
  TextTrackSchema,
  type AudioTrack,
  type TextTrack,
} from "@/core/adapters/PlaybackAdapter";
import { LanguageSchema } from "@/core/player/PlayerCommand";
export const TrackPreferencesSchema = z
  .object({
    version: z.literal(1),
    audioLang: LanguageSchema.nullable(),
    subtitleLang: LanguageSchema.nullable(),
    subtitleKind: z.enum(["original", "literal", "natural"]).optional(),
  })
  .strict();
export type TrackPreferences = z.infer<typeof TrackPreferencesSchema>;
export interface PreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
function browserStorage(): PreferenceStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}
export class TrackManager {
  private audio: AudioTrack[] = [];
  private text: TextTrack[] = [];
  private preferences: TrackPreferences = { version: 1, audioLang: null, subtitleLang: null };
  constructor(
    private readonly storage: PreferenceStorage | null = browserStorage(),
    private readonly key = "zivora:track-preferences:v1",
  ) {
    try {
      const stored = storage?.getItem(key);
      if (stored) {
        const parsed = TrackPreferencesSchema.safeParse(JSON.parse(stored));
        if (parsed.success) this.preferences = parsed.data;
      }
    } catch {
      /* Corrupt or unavailable storage cannot block playback. */
    }
  }
  setTracks(audio: unknown, text: unknown): void {
    const nextAudio = z.array(AudioTrackSchema).parse(audio);
    const nextText = z.array(TextTrackSchema).parse(text);
    for (const tracks of [nextAudio, nextText])
      if (new Set(tracks.map((track) => track.id)).size !== tracks.length)
        throw new Error("Duplicate track IDs");
    this.audio = nextAudio;
    this.text = nextText;
  }
  private resolve<T extends AudioTrack | TextTrack>(tracks: T[], language: string): T | null {
    const lang = LanguageSchema.parse(language).toLowerCase();
    const exact = tracks.filter((track) => track.language.toLowerCase() === lang);
    const candidates = exact.length
      ? exact
      : tracks.filter((track) => track.language.toLowerCase().split("-")[0] === lang.split("-")[0]);
    const track = candidates.find((track) => track.active) ?? candidates[0];
    return track ? { ...track } : null;
  }
  resolveAudio(lang: string): AudioTrack | null {
    const track = this.resolve(this.audio, lang);
    return track ? { ...track, roles: [...track.roles] } : null;
  }
  resolveSubtitle(lang: string, kind?: "original" | "literal" | "natural"): TextTrack | null {
    return this.resolve(
      kind
        ? this.text.filter((t) => (t.kind === "subtitles" ? "original" : t.kind) === kind)
        : this.text,
      lang,
    );
  }
  preferAudio(lang: string): void {
    this.save({ ...this.preferences, audioLang: LanguageSchema.parse(lang) });
  }
  preferSubtitle(lang: string | null, kind?: "original" | "literal" | "natural"): void {
    this.save({
      ...this.preferences,
      subtitleLang: LanguageSchema.nullable().parse(lang),
      ...(kind ? { subtitleKind: kind } : {}),
    });
  }
  private save(preferences: TrackPreferences): void {
    this.preferences = preferences;
    try {
      this.storage?.setItem(this.key, JSON.stringify(preferences));
    } catch {
      /* In-memory preferences remain usable offline. */
    }
  }
  getSnapshot() {
    return {
      audio: this.audio.map((track) => ({ ...track, roles: [...track.roles] })),
      text: this.text.map((track) => ({ ...track })),
      preferences: { ...this.preferences },
    };
  }
}
