import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { probeMedia, type ProbeResult, type ProbeStream } from "./probe";
import { NodeProcessRunner, type CommandSpec, type ProcessRunner } from "./processRunner";

const languageAliases: Readonly<Record<string, string>> = {
  eng: "en",
  spa: "es",
  fre: "fr",
  fra: "fr",
  ger: "de",
  deu: "de",
  ita: "it",
  por: "pt",
  jpn: "ja",
  kor: "ko",
  chi: "zh",
  zho: "zh",
  ara: "ar",
  hin: "hi",
  rus: "ru",
  und: "und",
};

export function normalizeLanguageTag(input: unknown, fallback: string): string {
  const value = typeof input === "string" ? input.trim().replaceAll("_", "-").toLowerCase() : "";
  const aliased = languageAliases[value] ?? value;
  if (/^[a-z]{2,8}(?:-[a-z0-9]{1,8})*$/.test(aliased)) return aliased;
  return z
    .string()
    .regex(/^und-x-(?:audio|subtitle)-\d+$/)
    .parse(fallback);
}

export interface ExtractedAudioTrack {
  sourceStreamIndex: number;
  language: string;
  label: string;
  channels: number | null;
  path: string;
  codec: "aac";
  bitrate: 192000;
}

export function buildAudioExtractionCommand(
  inputPath: string,
  outputPath: string,
  stream: ProbeStream,
  language: string,
  ffmpegBinary = "ffmpeg",
): CommandSpec {
  if (stream.codec_type !== "audio") throw new Error("Audio extraction requires an audio stream");
  return {
    command: ffmpegBinary,
    args: [
      "-hide_banner",
      "-nostdin",
      "-y",
      "-i",
      inputPath,
      "-map",
      `0:${stream.index}`,
      "-vn",
      "-sn",
      "-dn",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-ar",
      "48000",
      "-metadata:s:a:0",
      `language=${language}`,
      "-map_metadata",
      "-1",
      "-movflags",
      "+faststart",
      outputPath,
    ],
  };
}

export async function extractAudioTracks(
  inputPath: string,
  outputDirectory: string,
  probe: ProbeResult,
  runner: ProcessRunner = new NodeProcessRunner(),
  ffmpegBinary = "ffmpeg",
): Promise<ExtractedAudioTrack[]> {
  await mkdir(outputDirectory, { recursive: true });
  const streams = probe.streams.filter((stream) => stream.codec_type === "audio");
  const outputs: ExtractedAudioTrack[] = [];
  for (const [order, stream] of streams.entries()) {
    const language = normalizeLanguageTag(stream.tags.language, `und-x-audio-${order + 1}`);
    const label = stream.tags.title?.trim() || language;
    const path = join(outputDirectory, `${String(order + 1).padStart(2, "0")}-${language}.m4a`);
    await runner.run(buildAudioExtractionCommand(inputPath, path, stream, language, ffmpegBinary));
    outputs.push({
      sourceStreamIndex: stream.index,
      language,
      label,
      channels: stream.channels ?? null,
      path,
      codec: "aac",
      bitrate: 192000,
    });
  }
  return outputs;
}

async function main(): Promise<void> {
  const [inputPath, outputDirectory] = process.argv.slice(2);
  if (!inputPath || !outputDirectory)
    throw new Error("Usage: tsx pipeline/media/audio.ts <input-media> <output-directory>");
  const probe = await probeMedia(inputPath);
  process.stdout.write(
    `${JSON.stringify(await extractAudioTracks(inputPath, outputDirectory, probe), null, 2)}\n`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  void main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
