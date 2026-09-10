import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { LanguageSchema } from "@/core/player/PlayerCommand";
import {
  parseWebVtt,
  serializeWebVtt,
  plainCueText,
  type SubtitleCue,
} from "@/features/subtitles/vtt";
import { detectSubtitleLanguage } from "@/features/subtitles/language";
import { correctSubtitleDrift, DriftAnchorsSchema } from "@/features/subtitles/timing";
import type { ConvertedSubtitleTrack } from "./subtitles";
const translatedCue = z
  .object({ text: z.string().min(1).max(16000), hint: z.string().max(1000).optional() })
  .strict();
export const SubtitleEnrichmentSchema = z
  .object({
    anchors: DriftAnchorsSchema.default([]),
    speakers: z
      .array(
        z.object({ id: z.string().min(1).max(128), name: z.string().min(1).max(200) }).strict(),
      )
      .max(10000)
      .default([]),
    transcript: z
      .array(
        z
          .object({
            start: z.number().nonnegative().finite(),
            end: z.number().nonnegative().finite(),
            speakerId: z.string().min(1).max(128),
          })
          .strict()
          .refine((s) => s.end > s.start),
      )
      .max(200000)
      .default([]),
    hints: z.record(z.string().regex(/^\d+$/), z.string().max(1000)).default({}),
    variants: z
      .array(
        z
          .object({
            language: LanguageSchema,
            kind: z.enum(["literal", "natural"]),
            cues: z.array(translatedCue).max(200000).optional(),
          })
          .strict(),
      )
      .max(100)
      .default([]),
  })
  .strict();
export type OfflineSubtitleTranslator = (request: {
  sourceLanguage: string;
  targetLanguage: string;
  kind: "literal" | "natural";
  cues: readonly SubtitleCue[];
}) => Promise<unknown>;
const escape = (text: string) =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\r\n?/g, "\n")
    .replace(/\n\s*\n/g, "\n");
/** Runs only at ingestion. Translator dependencies must be offline/local or gateway-owned. */
export async function enrichSubtitleTrack(
  source: ConvertedSubtitleTrack,
  input: unknown,
  outputDirectory: string,
  duration: number,
  translate?: OfflineSubtitleTranslator,
): Promise<ConvertedSubtitleTrack[]> {
  const options = SubtitleEnrichmentSchema.parse(input);
  const original = parseWebVtt(await readFile(source.path, "utf8"));
  if (!original.length) throw new Error("Cannot enrich an empty subtitle track");
  const language = source.language.startsWith("und")
    ? detectSubtitleLanguage(original.map((c) => c.text).join(" ")).language
    : LanguageSchema.parse(source.language);
  const names = new Map(options.speakers.map((s) => [s.id, s.name]));
  if (names.size !== options.speakers.length) throw new Error("Duplicate transcript speaker IDs");
  if (options.transcript.some((s) => !names.has(s.speakerId)))
    throw new Error("Unknown transcript speaker");
  const aligned = correctSubtitleDrift(original, options.anchors, duration);
  const cues = aligned.map((cue, index) => {
    let speaker = cue.speaker;
    let overlap = 0;
    for (const segment of options.transcript) {
      const seconds = Math.min(cue.end, segment.end) - Math.max(cue.start, segment.start);
      if (seconds > overlap) {
        overlap = seconds;
        speaker = names.get(segment.speakerId);
      }
    }
    return {
      ...cue,
      text: escape(plainCueText(cue.text)),
      ...(speaker ? { speaker } : {}),
      ...(options.hints[index] ? { hint: options.hints[index] } : {}),
    };
  });
  const variants: {
    language: string;
    kind: "original" | "literal" | "natural";
    cues: SubtitleCue[];
  }[] = [{ language, kind: "original", cues }];
  const keys = new Set<string>();
  for (const variant of options.variants) {
    const key = `${variant.language}:${variant.kind}`;
    if (keys.has(key)) throw new Error("Duplicate subtitle variant");
    keys.add(key);
    if (!variant.cues && !translate)
      throw new Error(
        "Translation variants require offline translated cues or an ingestion translator",
      );
    const translated = z
      .array(translatedCue)
      .length(cues.length)
      .parse(
        variant.cues ??
          (await translate!({
            sourceLanguage: language,
            targetLanguage: variant.language,
            kind: variant.kind,
            cues,
          })),
      );
    variants.push({
      ...variant,
      cues: cues.map((cue, i) => ({
        ...cue,
        text: escape(translated[i].text),
        hint: translated[i].hint ?? cue.hint,
      })),
    });
  }
  // Validate everything before creating a new directory. Existing assets are never overwritten.
  const prepared = variants.map((v) => ({ ...v, vtt: serializeWebVtt(v.cues) }));
  await mkdir(outputDirectory, { recursive: false });
  const tracks: ConvertedSubtitleTrack[] = [];
  for (const variant of prepared) {
    const path = join(outputDirectory, `${variant.language}-${variant.kind}.vtt`);
    await writeFile(path, variant.vtt, { encoding: "utf8", flag: "wx" });
    tracks.push({
      ...source,
      path,
      language: variant.language,
      label: `${variant.language} [${variant.kind}]`,
      kind: variant.kind,
      hasSpeakerNames: variant.cues.some((c) => Boolean(c.speaker)),
      hasContextHints: variant.cues.some((c) => Boolean(c.hint)),
      cueCount: variant.cues.length,
    });
  }
  return tracks;
}
