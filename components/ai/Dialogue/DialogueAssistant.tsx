"use client";
import { useZivoraAI } from "../ZivoraAI";
export function DialogueAssistant() {
  const { askDialogue, disabled } = useZivoraAI();
  return (
    <div className="flex flex-wrap gap-2">
      <button
        type="button"
        disabled={disabled}
        className="zivora-ai-chip"
        onClick={() => void askDialogue("what_was_said")}
      >
        What was just said?
      </button>
      <button
        type="button"
        disabled={disabled}
        className="zivora-ai-chip"
        onClick={() => void askDialogue("meaning")}
      >
        What does it mean?
      </button>
      <button
        type="button"
        disabled={disabled}
        className="zivora-ai-chip"
        onClick={() => void askDialogue("reference")}
      >
        Explain reference
      </button>
    </div>
  );
}
