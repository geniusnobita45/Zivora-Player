import { createStore } from "zustand/vanilla";
import { z } from "zod";
import { LanguageSchema } from "@/core/player/PlayerCommand";
import { SubtitleKindSchema } from "@/features/subtitles/vtt";
import {
  PresentedCueSchema,
  type PresentedCue,
  type TextPresentation,
} from "@/core/adapters/TextPresentation";
import type { PreferenceStorage } from "@/core/streaming/TrackManager";
export const SubtitlePreferencesSchema = z
  .object({
    language: LanguageSchema.nullable(),
    kind: SubtitleKindSchema,
    speakerNames: z.boolean(),
    contextHints: z.boolean(),
    size: z.enum(["normal", "large"]),
    position: z.enum(["bottom", "top"]),
  })
  .strict();
export type SubtitlePreferences = z.infer<typeof SubtitlePreferencesSchema>;
const defaults: SubtitlePreferences = {
  language: null,
  kind: "original",
  speakerNames: false,
  contextHints: false,
  size: "normal",
  position: "bottom",
};
function storage(): PreferenceStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}
export function createSubtitleStore(
  userId: string | null = null,
  persistence: PreferenceStorage | null = storage(),
) {
  const key = `zivora:subtitle-preferences:v1:${z.string().uuid().nullable().parse(userId) ?? "guest"}`;
  let preferences = { ...defaults };
  try {
    const raw = persistence?.getItem(key);
    if (raw) preferences = SubtitlePreferencesSchema.parse(JSON.parse(raw));
  } catch {
    /* Preference failure never blocks playback. */
  }
  const store = createStore<{
    preferences: SubtitlePreferences;
    cues: readonly PresentedCue[];
    visible: boolean;
    healthy: boolean;
  }>(() => ({ preferences, cues: [], visible: false, healthy: false }));
  return Object.assign(store, {
    setPreferences(input: unknown): boolean {
      const result = SubtitlePreferencesSchema.safeParse(input);
      if (!result.success) return false;
      store.setState({ preferences: result.data });
      try {
        persistence?.setItem(key, JSON.stringify(result.data));
      } catch {
        /* Memory remains authoritative. */
      }
      return true;
    },
    presentation: {
      render(cues: readonly PresentedCue[], visible: boolean): boolean {
        try {
          const parsed = z.array(PresentedCueSchema).max(100).parse(cues);
          const current = store.getState();
          if (
            current.visible !== visible ||
            JSON.stringify(parsed) !== JSON.stringify(current.cues)
          )
            store.setState({ cues: parsed, visible });
          return current.healthy;
        } catch {
          store.setState({ healthy: false });
          return false;
        }
      },
    } satisfies TextPresentation,
  });
}
export type SubtitleStore = ReturnType<typeof createSubtitleStore>;
