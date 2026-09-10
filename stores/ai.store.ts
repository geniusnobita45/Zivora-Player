import { createStore } from "zustand/vanilla";
import { z } from "zod";
import { AIResponseSchema } from "@/features/ai/orchestrator/contracts";
import { SpoilerModeSchema, type SpoilerMode } from "@/features/ai/spoiler-guard/WatchBoundary";

type AIResponse = z.infer<typeof AIResponseSchema>;
export type AIPhase = "idle" | "retrieving" | "streaming" | "complete" | "error";
export interface AIStoreState {
  mode: SpoilerMode;
  phase: AIPhase;
  answer: AIResponse | null;
  error: string | null;
  requestId: string | null;
  setMode: (mode: unknown) => void;
  begin: (requestId: string) => void;
  setStreaming: () => void;
  complete: (answer: unknown) => void;
  fail: (message?: string) => void;
  reset: () => void;
}
export function createAIStore(initialMode: SpoilerMode = "strict_current") {
  return createStore<AIStoreState>((set) => ({
    mode: SpoilerModeSchema.parse(initialMode),
    phase: "idle",
    answer: null,
    error: null,
    requestId: null,
    setMode: (mode) => set({ mode: SpoilerModeSchema.parse(mode) }),
    begin: (requestId) => set({ phase: "retrieving", requestId, error: null }),
    setStreaming: () =>
      set((state) => (state.phase === "retrieving" ? { phase: "streaming" } : {})),
    complete: (answer) =>
      set({ phase: "complete", answer: AIResponseSchema.parse(answer), error: null }),
    fail: (message = "Ask Zivora is unavailable right now.") =>
      set({ phase: "error", error: z.string().trim().min(1).max(300).parse(message) }),
    reset: () => set({ phase: "idle", answer: null, error: null, requestId: null }),
  }));
}
export type AIStore = ReturnType<typeof createAIStore>;
