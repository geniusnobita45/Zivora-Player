import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { normalizeLanguageTag } from "./audio";
import { probeMedia, type ProbeResult, type ProbeStream } from "./probe";
import { NodeProcessRunner, type CommandSpec, type ProcessRunner } from "./processRunner";
import { detectSubtitleLanguage as detectLanguage } from "@/features/subtitles/language";

export interface SubtitleCue {
  identifier?: string;
  start: number;
  end: number;
  settings: string;
  text: string;
}

export interface ConvertedSubtitleTrack {
  kind?: "original" | "literal" | "natural";
  hasSpeakerNames?: boolean;
  hasContextHints?: boolean;
  sourceStreamIndex: number | null;
  language: string;
  label: string;
  path: string;
  format: "webvtt";
  cueCount: number;
}

export { enrichSubtitleTrack, SubtitleEnrichmentSchema } from "./subtitleEnrichment";
export { detectSubtitleLanguage } from "@/features/subtitles/language";
export { correctSubtitleDrift, validateSubtitleTiming } from "@/features/subtitles/timing";

export function parseSubtitleTimestamp(input: string): number {
  const normalized = input.trim().replace(",", ".");
  const parts = normalized.split(":");
  if (parts.length < 2 || parts.length > 3) throw new Error(`Invalid subtitle timestamp: ${input}`);
  const [hours, minutes, seconds] = parts.length === 3 ? parts : ["0", parts[0], parts[1]];
  if (
    !/^\d+$/.test(hours) ||
    !/^\d{1,2}$/.test(minutes) ||
    !/^\d{1,2}(?:\.\d{1,3})?$/.test(seconds)
  ) {
    throw new Error(`Invalid subtitle timestamp: ${input}`);
  }
  const value = Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds);
  if (!Number.isFinite(value) || Number(minutes) > 59 || Number(seconds) >= 60)
    throw new Error(`Invalid subtitle timestamp: ${input}`);
  return value;
}

export function formatWebVttTimestamp(seconds: number): string {
  const milliseconds = Math.max(0, Math.round(z.number().finite().parse(seconds) * 1000));
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const remainder = Math.floor((milliseconds % 60_000) / 1000);
  const millis = milliseconds % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

export function parseWebVtt(input: string): SubtitleCue[] {
  const normalized = z
    .string()
    .parse(input)
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .trim();
  const blocks = normalized.split(/\n{2,}/);
  const cues: SubtitleCue[] = [];
  for (const [blockIndex, block] of blocks.entries()) {
    const lines = block.split("\n");
    if (blockIndex === 0 && lines[0]?.startsWith("WEBVTT")) {
      lines.shift();
      if (!lines.length) continue;
    }
    if (!lines.length || /^(NOTE|STYLE|REGION)(?:\s|$)/.test(lines[0])) continue;
    const timingIndex = lines.findIndex((line) => line.includes("-->"));
    if (timingIndex < 0) continue;
    const identifier = timingIndex > 0 ? lines.slice(0, timingIndex).join(" ").trim() : undefined;
    const timing = lines[timingIndex].match(/^\s*(\S+)\s+-->\s+(\S+)(?:\s+(.*))?\s*$/);
    if (!timing) throw new Error(`Invalid subtitle cue timing: ${lines[timingIndex]}`);
    const start = parseSubtitleTimestamp(timing[1]);
    const end = parseSubtitleTimestamp(timing[2]);
    if (end <= start) throw new Error("Subtitle cue end must follow its start");
    const text = lines
      .slice(timingIndex + 1)
      .join("\n")
      .trim();
    if (!text) throw new Error("Subtitle cue text cannot be empty");
    cues.push({
      ...(identifier ? { identifier } : {}),
      start,
      end,
      settings: timing[3]?.trim() ?? "",
      text,
    });
  }
  return cues.sort((left, right) => left.start - right.start || left.end - right.end);
}

export function normalizeWebVtt(
  input: string,
  duration?: number,
): { text: string; cues: SubtitleCue[] } {
  const maximum =
    duration === undefined ? Infinity : z.number().finite().positive().parse(duration);
  const cues = parseWebVtt(input)
    .filter((cue) => cue.start < maximum)
    .map((cue) => ({ ...cue, end: Math.min(cue.end, maximum) }))
    .filter((cue) => cue.end > cue.start);
  const body = cues
    .map((cue) =>
      [
        cue.identifier,
        `${formatWebVttTimestamp(cue.start)} --> ${formatWebVttTimestamp(cue.end)}${cue.settings ? ` ${cue.settings}` : ""}`,
        cue.text,
      ]
        .filter((line): line is string => Boolean(line))
        .join("\n"),
    )
    .join("\n\n");
  return { text: `WEBVTT\n\n${body}${body ? "\n" : ""}`, cues };
}

export function buildSubtitleConversionCommand(
  inputPath: string,
  outputPath: string,
  ffmpegBinary = "ffmpeg",
  streamIndex?: number,
): CommandSpec {
  const extension = extname(inputPath).toLowerCase();
  if (streamIndex === undefined && ![".srt", ".ass", ".ssa", ".vtt"].includes(extension)) {
    throw new Error(`Unsupported subtitle format: ${extension || "unknown"}`);
  }
  return {
    command: ffmpegBinary,
    args: [
      "-hide_banner",
      "-nostdin",
      "-y",
      "-i",
      inputPath,
      ...(streamIndex === undefined ? [] : ["-map", `0:${streamIndex}`]),
      "-map_metadata",
      "-1",
      "-f",
      "webvtt",
      outputPath,
    ],
  };
}

async function convertToNormalizedWebVtt(
  command: CommandSpec,
  outputPath: string,
  duration: number,
  runner: ProcessRunner,
  preserveTiming = false,
): Promise<number> {
  const temporaryPath = `${outputPath}.ffmpeg-${process.pid}-${Date.now()}.vtt`;
  try {
    await runner.run({
      ...command,
      args: command.args.map((argument) => (argument === outputPath ? temporaryPath : argument)),
    });
    const normalized = normalizeWebVtt(
      await readFile(temporaryPath, "utf8"),
      preserveTiming ? undefined : duration,
    );
    await writeFile(outputPath, normalized.text, "utf8");
    return normalized.cues.length;
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

export async function convertSubtitleFile(
  inputPath: string,
  outputPath: string,
  duration: number,
  runner: ProcessRunner = new NodeProcessRunner(),
  ffmpegBinary = "ffmpeg",
  languageInput: string = "und",
  preserveTiming = false,
): Promise<ConvertedSubtitleTrack> {
  await mkdir(dirname(outputPath), { recursive: true });
  let language =
    languageInput === "und" ? "und" : normalizeLanguageTag(languageInput, "und-x-subtitle-1");
  const cueCount = await convertToNormalizedWebVtt(
    buildSubtitleConversionCommand(inputPath, outputPath, ffmpegBinary),
    outputPath,
    duration,
    runner,
    preserveTiming,
  );
  if (language.startsWith("und"))
    language = detectLanguage(
      parseWebVtt(await readFile(outputPath, "utf8"))
        .map((cue) => cue.text)
        .join(" "),
    ).language;
  return {
    sourceStreamIndex: null,
    language,
    label: language,
    path: outputPath,
    format: "webvtt",
    cueCount,
  };
}

export async function extractSubtitleTracks(
  inputPath: string,
  outputDirectory: string,
  probe: ProbeResult,
  runner: ProcessRunner = new NodeProcessRunner(),
  ffmpegBinary = "ffmpeg",
  preserveTiming = false,
): Promise<ConvertedSubtitleTrack[]> {
  await mkdir(outputDirectory, { recursive: true });
  const streams = probe.streams.filter(
    (stream): stream is ProbeStream => stream.codec_type === "subtitle",
  );
  const outputs: ConvertedSubtitleTrack[] = [];
  for (const [order, stream] of streams.entries()) {
    let language = normalizeLanguageTag(stream.tags.language, `und-x-subtitle-${order + 1}`);
    const path = join(outputDirectory, `${String(order + 1).padStart(2, "0")}-${language}.vtt`);
    const cueCount = await convertToNormalizedWebVtt(
      buildSubtitleConversionCommand(inputPath, path, ffmpegBinary, stream.index),
      path,
      probe.format.duration,
      runner,
      preserveTiming,
    );
    if (language.startsWith("und"))
      language = detectLanguage(
        parseWebVtt(await readFile(path, "utf8"))
          .map((cue) => cue.text)
          .join(" "),
      ).language;
    outputs.push({
      sourceStreamIndex: stream.index,
      language,
      label: stream.tags.title?.trim() || language,
      path,
      format: "webvtt",
      cueCount,
    });
  }
  return outputs;
}

async function main(): Promise<void> {
  const [inputPath, outputPath, durationInput] = process.argv.slice(2);
  if (!inputPath || !outputPath)
    throw new Error(
      "Usage: tsx pipeline/media/subtitles.ts <input.srt|ass|vtt> <output.vtt> [duration-seconds]",
    );
  const duration = durationInput
    ? z.coerce.number().positive().parse(durationInput)
    : (await probeMedia(inputPath)).format.duration;
  process.stdout.write(
    `${JSON.stringify(await convertSubtitleFile(inputPath, outputPath, duration), null, 2)}\n`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  void main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
