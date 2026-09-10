"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useStore } from "zustand";
import { z } from "zod";
import { createAIStore } from "@/stores/ai.store";
import { AIResponseSchema, type AIRequest } from "@/features/ai/orchestrator/contracts";
import {
  useDegradationManager,
  usePlayer,
  usePlayerStore,
} from "@/components/player/PlayerContext";
import { SceneSearchResults } from "./SceneSearch/SceneSearchResults";
import { RecapActions } from "./Recap/RecapActions";
import { CharacterAssistant } from "./Character/CharacterAssistant";
import { DialogueAssistant } from "./Dialogue/DialogueAssistant";
import { PlayerCommandResult } from "./Commands/PlayerCommandResult";
import { VoiceInteraction } from "./VoiceInteraction";

type RecapKind = "what_did_i_miss" | "previous_episode" | "season";
interface ZivoraAIContextValue {
  disabled: boolean;
  askCharacter(name: string): Promise<void>;
  askDialogue(action: "what_was_said" | "meaning" | "reference"): Promise<void>;
  requestRecap(kind: RecapKind): Promise<void>;
}
const ZivoraAIContext = createContext<ZivoraAIContextValue | null>(null);
export function useZivoraAI() {
  const value = useContext(ZivoraAIContext);
  if (!value) throw new Error("AI controls require ZivoraAI");
  return value;
}

const StreamEventSchema = z.object({ event: z.string().min(1), data: z.string() });
export function ZivoraAI() {
  const { item, controller } = usePlayer();
  const manager = useDegradationManager();
  const snapshot = usePlayerStore((state) => state.snapshot);
  const [store] = useState(createAIStore);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const state = useStore(store);
  const disabled = manager.getSnapshot().level >= 1 || !controller;
  useEffect(() => {
    try {
      setVoiceEnabled(window.localStorage.getItem("zivora:voice-enabled") === "true");
    } catch {
      /* optional preference */
    }
  }, []);
  const common = useCallback(
    (): Omit<AIRequest, "question"> => ({
      contentId: item.contentId,
      episodeId: item.episodeId,
      conversationId: state.answer?.conversationId ?? null,
      watchState: {
        // The server binds this to its catalog ordinal; the position itself is client live state.
        currentEpisodeOrder: 0,
        currentPosition: Math.max(0, snapshot?.position ?? 0),
        furthestEpisodeOrder: 0,
        furthestPosition: Math.max(0, snapshot?.position ?? 0),
      },
      mode: state.mode,
      language: "en",
      filters: {},
    }),
    [item.contentId, item.episodeId, snapshot?.position, state.answer?.conversationId, state.mode],
  );
  const request = useCallback(
    async (path: string, body: Record<string, unknown>, streaming = false) => {
      if (disabled) return;
      const id = crypto.randomUUID();
      store.getState().begin(id);
      try {
        const response = await fetch(path, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: streaming ? "text/event-stream" : "application/json",
          },
          credentials: "same-origin",
          body: JSON.stringify(body),
        });
        if (!response.ok) throw new Error("Ask Zivora is unavailable right now.");
        if (!streaming) {
          store.getState().complete(AIResponseSchema.parse(await response.json()));
          manager.reportHealthy("ai");
          return;
        }
        await consumeStream(response, (event, data) => {
          if (event === "retrieving") store.getState().setStreaming();
          if (event === "completed") {
            store.getState().complete(AIResponseSchema.parse(data));
            manager.reportHealthy("ai");
          }
          if (event === "error") throw new Error("Ask Zivora is unavailable right now.");
        });
      } catch {
        store.getState().fail();
        manager.reportUnavailable("ai", undefined);
      }
    },
    [disabled, manager, store],
  );
  const ask = useCallback(
    (question: string) => request("/api/ai/ask", { ...common(), question }, true),
    [common, request],
  );
  const value = useMemo<ZivoraAIContextValue>(
    () => ({
      disabled,
      askCharacter: (characterName) => request("/api/ai/character", { ...common(), characterName }),
      askDialogue: (action) => request("/api/ai/dialogue", { ...common(), action }),
      requestRecap: (kind) => request("/api/ai/recap", { ...common(), kind }),
    }),
    [common, disabled, request],
  );
  return (
    <ZivoraAIContext.Provider value={value}>
      <aside
        className="absolute bottom-4 right-4 z-20 w-[min(25rem,calc(100%-2rem))] rounded-xl border border-slate-700/90 bg-slate-950/95 p-3 text-slate-100 shadow-2xl backdrop-blur"
        aria-label="Ask Zivora"
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-bold tracking-[.16em] text-violet-300">ASK ZIVORA</p>
            <p className="text-xs text-slate-400">Spoiler-safe companion</p>
          </div>
          <select
            aria-label="Spoiler knowledge mode"
            value={state.mode}
            onChange={(event) => store.getState().setMode(event.target.value)}
            className="rounded border border-slate-600 bg-slate-900 p-1 text-xs"
            disabled={disabled}
          >
            <option value="strict_current">Strict current scene</option>
            <option value="watched_knowledge">Watched knowledge</option>
          </select>
        </div>
        {disabled ? (
          <p className="text-xs text-slate-400" role="status">
            AI is temporarily unavailable. Playback continues normally.
          </p>
        ) : (
          <>
            <form
              className="mb-3 flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                const question = String(form.get("question") ?? "").trim();
                if (question) {
                  void ask(question);
                  event.currentTarget.reset();
                }
              }}
            >
              <label className="sr-only" htmlFor="zivora-question">
                Ask about this video
              </label>
              <input
                id="zivora-question"
                name="question"
                maxLength={500}
                placeholder="Ask about this scene"
                className="min-w-0 flex-1 rounded-md border border-slate-600 bg-slate-900 px-3 py-2 text-sm"
                disabled={state.phase === "retrieving" || state.phase === "streaming"}
              />
              <button
                type="submit"
                className="zivora-ai-chip"
                disabled={state.phase === "retrieving" || state.phase === "streaming"}
              >
                Ask
              </button>
            </form>
            <div className="mb-3">
              <RecapActions />
            </div>
            <div className="mb-3">
              <DialogueAssistant />
            </div>
            <div className="mb-3">
              <CharacterAssistant />
            </div>
          </>
        )}
        <VoiceInteraction
          enabled={voiceEnabled && !disabled}
          onTranscript={(question) => void ask(question)}
          answer={state.answer?.answer}
        />
        {(state.phase === "retrieving" || state.phase === "streaming") && (
          <p role="status" className="text-xs text-violet-200">
            {state.phase === "retrieving"
              ? "Finding watched evidence…"
              : "Drafting a grounded answer…"}
          </p>
        )}
        {state.error && (
          <p role="alert" className="text-xs text-rose-300">
            {state.error}
          </p>
        )}
        {state.answer && (
          <div className="space-y-2 text-sm">
            <p>{state.answer.answer}</p>
            <SceneSearchResults answer={state.answer} />
            {state.answer.command && <PlayerCommandResult command={state.answer.command} />}
          </div>
        )}
      </aside>
    </ZivoraAIContext.Provider>
  );
}
async function consumeStream(response: Response, onEvent: (event: string, data: unknown) => void) {
  if (!response.body) throw new Error("AI stream unavailable");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      const messages = buffer.split("\n\n");
      buffer = messages.pop() ?? "";
      for (const raw of messages) {
        const event = StreamEventSchema.safeParse({
          event: raw.match(/^event: (.+)$/m)?.[1],
          data: raw.match(/^data: (.+)$/m)?.[1],
        });
        if (event.success) onEvent(event.data.event, JSON.parse(event.data.data));
      }
    }
  } finally {
    reader.releaseLock();
  }
}
