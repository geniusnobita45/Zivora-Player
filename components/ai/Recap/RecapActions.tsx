"use client";
import { useZivoraAI } from "../ZivoraAI";
export function RecapActions() {
  const { requestRecap, disabled } = useZivoraAI();
  return (
    <div className="flex flex-wrap gap-2">
      <button
        type="button"
        disabled={disabled}
        onClick={() => requestRecap("what_did_i_miss")}
        className="zivora-ai-chip"
      >
        What did I miss?
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={() => requestRecap("previous_episode")}
        className="zivora-ai-chip"
      >
        Previous episode
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={() => requestRecap("season")}
        className="zivora-ai-chip"
      >
        Season so far
      </button>
    </div>
  );
}
