import { z } from "zod";
import type { ProcessRunner } from "@/pipeline/media/processRunner";
import { SkipSegmentSchema, stableUuid } from "./types";

export const EpisodeFingerprintSchema = z
  .object({ position: z.enum(["opening", "ending"]), fingerprint: z.string().min(8).max(100000) })
  .strict();
export type EpisodeFingerprint = z.infer<typeof EpisodeFingerprintSchema>;
function shingles(value: string) {
  const clean = value.replace(/\s+/g, "");
  const set = new Set<string>();
  for (let i = 0; i < clean.length - 3; i++) set.add(clean.slice(i, i + 4));
  return set;
}
export function fingerprintSimilarity(a: string, b: string): number {
  const left = shingles(a),
    right = shingles(b);
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const item of left) if (right.has(item)) shared++;
  return (2 * shared) / (left.size + right.size);
}
async function fingerprint(
  runner: ProcessRunner,
  mediaPath: string,
  start: number,
  duration: number,
  ffmpeg: string,
) {
  const result = await runner.run({
    command: ffmpeg,
    args: [
      "-hide_banner",
      "-ss",
      String(start),
      "-t",
      String(duration),
      "-i",
      mediaPath,
      "-vn",
      "-ac",
      "1",
      "-ar",
      "11025",
      "-f",
      "chromaprint",
      "-",
    ],
  });
  return result.stdout.trim();
}
export async function detectSkipSegments(
  runner: ProcessRunner,
  mediaVersionId: string,
  mediaPath: string,
  duration: number,
  related: readonly EpisodeFingerprint[] = [],
  ffmpeg = "ffmpeg",
) {
  const safeDuration = z.number().positive().max(86400).parse(duration),
    window = Math.min(180, safeDuration / 3);
  const opening = await fingerprint(runner, mediaPath, 0, window, ffmpeg);
  const ending = await fingerprint(
    runner,
    mediaPath,
    Math.max(0, safeDuration - window),
    window,
    ffmpeg,
  );
  const black = await runner.run({
    command: ffmpeg,
    args: [
      "-hide_banner",
      "-i",
      mediaPath,
      "-vf",
      "blackdetect=d=0.5:pix_th=0.10",
      "-an",
      "-f",
      "null",
      "-",
    ],
  });
  const blackStarts = [...black.stderr.matchAll(/black_start:([0-9]+(?:\.[0-9]+)?)/g)].map(
    (match) => Number(match[1]),
  );
  const openingSimilarity = Math.max(
    0,
    ...related
      .filter((item) => item.position === "opening")
      .map((item) => fingerprintSimilarity(opening, item.fingerprint)),
  );
  const recapSimilarity = Math.max(
    0,
    ...related
      .filter((item) => item.position === "ending")
      .map((item) => fingerprintSimilarity(opening, item.fingerprint)),
  );
  const creditsStart =
    blackStarts.filter((value) => value > safeDuration * 0.7).at(-1) ??
    Math.max(0, safeDuration - window / 2);
  const candidates = [
    ...(openingSimilarity >= 0.7
      ? [
          {
            kind: "intro" as const,
            start: 0,
            end: window,
            confidence: openingSimilarity,
            evidence: { audioSimilarity: openingSimilarity },
          },
        ]
      : []),
    ...(recapSimilarity >= 0.7
      ? [
          {
            kind: "recap" as const,
            start: 0,
            end: Math.min(90, window),
            confidence: recapSimilarity,
            evidence: { previousEndingSimilarity: recapSimilarity },
          },
        ]
      : []),
    {
      kind: "credits" as const,
      start: creditsStart,
      end: safeDuration,
      confidence: blackStarts.length ? 0.9 : 0.55,
      evidence: { blackFrameDetected: blackStarts.length > 0 },
    },
  ].filter((item) => item.end > item.start);
  return {
    segments: z.array(SkipSegmentSchema).parse(
      candidates.map((item) => ({
        ...item,
        id: stableUuid(mediaVersionId, "skip", item.kind, item.start),
      })),
    ),
    fingerprints: [
      { position: "opening" as const, fingerprint: opening },
      { position: "ending" as const, fingerprint: ending },
    ],
  };
}
