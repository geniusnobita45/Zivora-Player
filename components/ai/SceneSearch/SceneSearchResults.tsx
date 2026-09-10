"use client";
import type { AIAnswer } from "@/features/ai/orchestrator/contracts";
import { usePlayer } from "@/components/player/PlayerContext";

export function SceneSearchResults({ answer }: { answer: AIAnswer }) {
  const { perform } = usePlayer();
  if (!answer.candidates.length) return null;
  return (
    <div className="flex flex-wrap gap-2" aria-label="Scene matches">
      {answer.candidates.map((candidate) => (
        <button
          key={`${candidate.evidenceId ?? candidate.label}-${candidate.timestamp}`}
          type="button"
          className="rounded-full border border-slate-600 bg-slate-900 px-3 py-1.5 text-left text-xs text-slate-100 hover:border-violet-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-200"
          onClick={() =>
            perform((controller) =>
              controller.seekTo(candidate.timestamp, {
                source: "ai",
                reason: "AI scene candidate",
              }),
            )
          }
        >
          {formatTime(candidate.timestamp)} · {candidate.label}
        </button>
      ))}
    </div>
  );
}
function formatTime(seconds: number) {
  const value = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const secs = value % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
    : `${minutes}:${String(secs).padStart(2, "0")}`;
}
