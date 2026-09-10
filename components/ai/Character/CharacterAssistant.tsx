"use client";
import { useState } from "react";
import { useZivoraAI } from "../ZivoraAI";
export function CharacterAssistant() {
  const [name, setName] = useState("");
  const { askCharacter, disabled } = useZivoraAI();
  return (
    <form
      className="flex gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (name.trim()) void askCharacter(name);
      }}
    >
      <label className="sr-only" htmlFor="zivora-character">
        Character name
      </label>
      <input
        id="zivora-character"
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="Who is this?"
        className="min-w-0 flex-1 rounded-md border border-slate-600 bg-slate-950 px-3 py-2 text-sm"
        disabled={disabled}
      />
      <button type="submit" className="zivora-ai-chip" disabled={disabled || !name.trim()}>
        Ask
      </button>
    </form>
  );
}
