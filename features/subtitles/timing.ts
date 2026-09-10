import { z } from "zod";
import { SubtitleCueSchema, type SubtitleCue } from "./vtt";
const AnchorSchema = z
  .object({ source: z.number().finite().nonnegative(), target: z.number().finite().nonnegative() })
  .strict();
export const DriftAnchorsSchema = z.array(AnchorSchema).max(1000);
export function driftModel(input: unknown): {
  scale: number;
  offset: number;
  maximumResidual: number;
} {
  const anchors = DriftAnchorsSchema.parse(input).sort((a, b) => a.source - b.source);
  if (!anchors.length) return { scale: 1, offset: 0, maximumResidual: 0 };
  if (anchors.length === 1)
    return { scale: 1, offset: anchors[0].target - anchors[0].source, maximumResidual: 0 };
  if (
    anchors.some(
      (a, i) => i > 0 && (a.source <= anchors[i - 1].source || a.target <= anchors[i - 1].target),
    )
  )
    throw new Error("Drift anchors must increase in both clocks");
  const meanX = anchors.reduce((s, a) => s + a.source, 0) / anchors.length;
  const meanY = anchors.reduce((s, a) => s + a.target, 0) / anchors.length;
  const scale =
    anchors.reduce((s, a) => s + (a.source - meanX) * (a.target - meanY), 0) /
    anchors.reduce((s, a) => s + (a.source - meanX) ** 2, 0);
  if (scale < 0.5 || scale > 2) throw new Error("Implausible drift scale");
  const offset = meanY - scale * meanX;
  const maximumResidual = Math.max(
    ...anchors.map((a) => Math.abs(a.target - (a.source * scale + offset))),
  );
  if (maximumResidual > 0.5) throw new Error("Drift anchors disagree by more than 500ms");
  return { scale, offset, maximumResidual };
}
export function validateSubtitleTiming(input: unknown, duration: number) {
  const total = z.number().finite().positive().max(86400).parse(duration);
  const parsed = z.array(SubtitleCueSchema).max(200000).safeParse(input);
  if (!parsed.success)
    return { valid: false, issues: parsed.error.issues.map((issue) => issue.message) };
  const issues: string[] = [];
  parsed.data.forEach((c, i) => {
    if (c.end > total) issues.push(`Cue ${i} exceeds duration`);
    if (i && c.start < parsed.data[i - 1].start) issues.push(`Cue ${i} is out of order`);
  });
  return { valid: issues.length === 0, issues };
}
export function correctSubtitleDrift(
  input: unknown,
  anchors: unknown,
  duration: number,
): SubtitleCue[] {
  const cues = z.array(SubtitleCueSchema).parse(input);
  const { scale, offset } = driftModel(anchors);
  const result = cues.map((c) => ({
    ...c,
    start: Math.round((c.start * scale + offset) * 1000) / 1000,
    end: Math.round((c.end * scale + offset) * 1000) / 1000,
  }));
  const report = validateSubtitleTiming(result, duration);
  if (!report.valid) throw new Error(report.issues.join("; "));
  return result;
}
