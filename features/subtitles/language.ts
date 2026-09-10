import { z } from "zod";
import { plainCueText } from "./vtt";
/** Conservative offline detection: ambiguous/short Latin samples are explicitly undetermined. */
export function detectSubtitleLanguage(input: unknown): { language: string; confidence: number } {
  const text = plainCueText(
    z
      .string()
      .max(32 * 1024 * 1024)
      .parse(input),
  ).toLowerCase();
  const scripts: [string, RegExp][] = [
    ["ja", /[\u3040-\u30ff]/g],
    ["ko", /[\uac00-\ud7af]/g],
    ["ar", /[\u0600-\u06ff]/g],
    ["hi", /[\u0900-\u097f]/g],
    ["zh", /[\u4e00-\u9fff]/g],
  ];
  for (const [language, pattern] of scripts)
    if ((text.match(pattern)?.length ?? 0) >= 8) return { language, confidence: 0.8 };
  const words = text.match(/\p{L}+/gu) ?? [];
  const lexicons: Record<string, string[]> = {
    en: ["the", "and", "you", "that", "this", "with", "what", "have", "not", "are"],
    es: ["que", "para", "con", "una", "por", "pero", "como", "está", "los", "las"],
    fr: ["les", "des", "une", "est", "pas", "vous", "pour", "avec", "mais", "dans"],
    de: ["der", "die", "das", "und", "ist", "nicht", "ich", "ein", "mit", "wir"],
  };
  const scores = Object.entries(lexicons)
    .map(([language, lexicon]) => ({
      language,
      score: words.filter((word) => lexicon.includes(word)).length,
    }))
    .sort((a, b) => b.score - a.score);
  if (scores[0].score < 3 || scores[0].score < scores[1].score * 1.5)
    return { language: "und", confidence: 0 };
  return {
    language: scores[0].language,
    confidence: Math.min(0.95, scores[0].score / Math.max(1, scores[0].score + scores[1].score)),
  };
}
