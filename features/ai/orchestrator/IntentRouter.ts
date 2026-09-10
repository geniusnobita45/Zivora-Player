import { z } from "zod";
import type { AIIntent } from "./contracts";
export class IntentRouter {
  route(input: unknown): AIIntent {
    const question = z
      .string()
      .trim()
      .min(1)
      .max(2000)
      .parse(input)
      .normalize("NFKC")
      .toLowerCase();
    const rules: [AIIntent, RegExp][] = [
      ["previously_watched", /\b(previously watched|seen before|watched before)\b/],
      [
        "control_player",
        /^(?:please\s+)?(?:play|pause|resume|mute|unmute|fullscreen|picture.in.picture|set (?:the )?(?:volume|speed)|seek to|skip (?:forward|back))\b/,
      ],
      ["who_is_character", /\b(who is|who's|which character|who was)\b/],
      ["recap", /\b(recap|summarize|summary|what did i miss)\b/],
      ["what_happened", /\b(what happened|why did|what just)\b/],
      ["explain_reference", /\b(reference|meaning of|explain|allusion)\b/],
      ["mood_search", /\b(mood|funny|sad|romantic|tense|exciting|scary)\b/],
      ["find_scene", /\b(find|scene|jump|take me|when did|show me)\b/],
    ];
    return rules.find(([, pattern]) => pattern.test(question))?.[0] ?? "general";
  }
}
