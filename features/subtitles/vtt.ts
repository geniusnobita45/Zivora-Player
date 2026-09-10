import { z } from "zod";
export const SubtitleKindSchema = z.enum(["original", "literal", "natural"]);
export const SubtitleAttributesSchema = z.object({
  "X-ZIVORA-KIND": SubtitleKindSchema.optional(),
  "X-ZIVORA-SPEAKERS": z.enum(["YES", "NO"]).optional(),
  "X-ZIVORA-HINTS": z.enum(["YES", "NO"]).optional(),
});
export type SubtitleKind = z.infer<typeof SubtitleKindSchema>;
export const CueMetadataSchema = z
  .object({
    speaker: z.string().max(200).optional(),
    hint: z.string().max(1000).optional(),
  })
  .strict();
export const SubtitleCueSchema = z
  .object({
    identifier: z.string().max(12000).optional(),
    start: z.number().finite().nonnegative(),
    end: z.number().finite().nonnegative(),
    settings: z.string().max(1000).default(""),
    text: z.string().min(1).max(16000),
    speaker: z.string().max(200).optional(),
    hint: z.string().max(1000).optional(),
  })
  .strict()
  .refine((c) => c.end > c.start);
export type SubtitleCue = z.infer<typeof SubtitleCueSchema>;
export function parseSubtitleTimestamp(input: string): number {
  const match = z
    .string()
    .max(32)
    .parse(input)
    .trim()
    .match(/^(?:(\d+):)?(\d{2}):(\d{2})[.,](\d{3})$/);
  if (!match || Number(match[2]) > 59 || Number(match[3]) > 59)
    throw new Error("Invalid subtitle timestamp");
  return (
    Number(match[1] ?? 0) * 3600 +
    Number(match[2]) * 60 +
    Number(match[3]) +
    Number(match[4]) / 1000
  );
}
export function formatWebVttTimestamp(seconds: number): string {
  const ms = Math.round(z.number().finite().nonnegative().parse(seconds) * 1000);
  return `${String(Math.floor(ms / 3600000)).padStart(2, "0")}:${String(Math.floor(ms / 60000) % 60).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}.${String(ms % 1000).padStart(3, "0")}`;
}
export function cueMetadata(identifier: string | undefined): z.infer<typeof CueMetadataSchema> {
  if (!identifier?.startsWith("zivora:")) return {};
  return CueMetadataSchema.parse(JSON.parse(decodeURIComponent(identifier.slice(7))));
}
export function cueIdentifier(metadata: z.input<typeof CueMetadataSchema>): string {
  return `zivora:${encodeURIComponent(JSON.stringify(CueMetadataSchema.parse(metadata)))}`;
}
export function plainCueText(text: string): string {
  return text
    .replace(/<[^>]*>/g, "")
    .replace(
      /&(amp|lt|gt|nbsp|quot|apos);/g,
      (_, entity: string) =>
        ({ amp: "&", lt: "<", gt: ">", nbsp: " ", quot: '"', apos: "'" })[entity]!,
    );
}
export function parseWebVtt(input: unknown): SubtitleCue[] {
  const normalized = z
    .string()
    .max(32 * 1024 * 1024)
    .parse(input)
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .trim();
  if (!/^WEBVTT(?:[ \t][^\n]*)?(?:\n|$)/.test(normalized)) throw new Error("Missing WEBVTT header");
  const blocks = normalized.split(/\n[ \t]*\n/);
  const header = blocks.shift()!;
  if (header.includes("-->")) throw new Error("A blank line must follow the WEBVTT header");
  const cues: SubtitleCue[] = [];
  for (const block of blocks) {
    const lines = block.trim().split("\n");
    if (!lines[0] || /^(NOTE|STYLE|REGION)(?:[ \t]|$)/.test(lines[0])) continue;
    const index = lines[0].includes("-->") ? 0 : 1;
    const match = lines[index]?.match(/^(\S+)\s+-->\s+(\S+)(?:\s+(.*))?$/);
    if (!match) throw new Error("Invalid WebVTT cue timing");
    const identifier = index ? lines[0] : undefined;
    const text = lines
      .slice(index + 1)
      .join("\n")
      .trim();
    const voice = /<v(?:\.[^ >]+)*\s+([^>]+)>/.exec(text)?.[1];
    const metadata = cueMetadata(identifier);
    cues.push(
      SubtitleCueSchema.parse({
        identifier,
        start: parseSubtitleTimestamp(match[1]),
        end: parseSubtitleTimestamp(match[2]),
        settings: match[3] ?? "",
        text,
        ...(voice ? { speaker: plainCueText(voice) } : {}),
        ...metadata,
      }),
    );
    if (cues.length > 200000) throw new Error("Too many subtitle cues");
  }
  return cues.sort((a, b) => a.start - b.start || a.end - b.end);
}
export function serializeWebVtt(input: readonly SubtitleCue[]): string {
  const cues = z.array(SubtitleCueSchema).max(200000).parse(input);
  return (
    "WEBVTT\n\n" +
    cues
      .map((c) => {
        const id =
          c.speaker || c.hint ? cueIdentifier({ speaker: c.speaker, hint: c.hint }) : c.identifier;
        if (id && /[\r\n]|-->/.test(id)) throw new Error("Invalid cue identifier");
        if (/[\r\n]/.test(c.settings) || /\n\s*\n/.test(c.text))
          throw new Error("Cue cannot contain a block separator");
        return [
          id,
          `${formatWebVttTimestamp(c.start)} --> ${formatWebVttTimestamp(c.end)}${c.settings ? ` ${c.settings}` : ""}`,
          c.text,
        ]
          .filter(Boolean)
          .join("\n");
      })
      .join("\n\n") +
    "\n"
  );
}
export function subtitleTrackKind(label: string): SubtitleKind {
  const kind = /\[(original|literal|natural)\]$/.exec(label)?.[1];
  return SubtitleKindSchema.parse(kind ?? "original");
}
