import { createStore } from "zustand/vanilla";
import { z } from "zod";

export const UserPreferencesSchema = z
  .object({
    locale: z.string().min(2).max(20),
    autoplay: z.boolean(),
    preferredAudioLanguage: z.string().nullable(),
    preferredSubtitleLanguage: z.string().nullable(),
    subtitlesEnabled: z.boolean(),
    aiEnabled: z.boolean(),
    voiceEnabled: z.boolean(),
    autoSkip: z.boolean(),
  })
  .strict();
export type UserPreferences = z.infer<typeof UserPreferencesSchema>;
export interface UserStoreState {
  userId: string | null;
  email: string | null;
  preferences: UserPreferences;
  setUser: (userId: string | null, email?: string | null) => void;
  setPreferences: (input: unknown) => void;
  clear: () => void;
}
const defaults: UserPreferences = {
  locale: "en",
  autoplay: true,
  preferredAudioLanguage: null,
  preferredSubtitleLanguage: null,
  subtitlesEnabled: false,
  aiEnabled: true,
  voiceEnabled: false,
  autoSkip: false,
};
export function createUserStore() {
  return createStore<UserStoreState>((set) => ({
    userId: null,
    email: null,
    preferences: defaults,
    setUser: (userId, email = null) => set({ userId, email }),
    setPreferences: (input) => set({ preferences: UserPreferencesSchema.parse(input) }),
    clear: () => set({ userId: null, email: null, preferences: defaults }),
  }));
}
export type UserStore = ReturnType<typeof createUserStore>;
