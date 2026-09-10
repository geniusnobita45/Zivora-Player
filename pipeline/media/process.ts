import { mkdir, rm, readFile } from "node:fs/promises";
import { enrichSubtitleTrack, SubtitleEnrichmentSchema } from "./subtitleEnrichment";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { normalizeLanguageTag, extractAudioTracks } from "./audio";
import { encodeAbrLadder } from "./encode";
import { packageHlsCmaf } from "./package";
import { probeMedia } from "./probe";
import { NodeProcessRunner } from "./processRunner";
import { convertSubtitleFile, extractSubtitleTracks } from "./subtitles";
import { generateThumbnails } from "./thumbnails";
import { MediaValidator, writeMediaDescriptor } from "@/pipeline/validation/MediaValidator";

const OptionsSchema = z
  .object({
    input: z.string().trim().min(1),
    subtitleEnrichment: z.string().min(1).optional(),
    output: z.string().trim().min(1),
    subtitles: z
      .array(z.object({ language: z.string().min(1), path: z.string().min(1) }))
      .default([]),
    ffmpeg: z.string().min(1).default("ffmpeg"),
    ffprobe: z.string().min(1).default("ffprobe"),
  })
  .strict();

export type ProcessVideoOptions = z.input<typeof OptionsSchema>;

export async function processVideo(input: ProcessVideoOptions) {
  const options = OptionsSchema.parse(input);
  const sourcePath = resolve(options.input);
  const outputDirectory = resolve(options.output);
  await mkdir(dirname(outputDirectory), { recursive: true });
  // A media version is immutable: processing refuses an existing version directory.
  await mkdir(outputDirectory, { recursive: false });
  const workDirectory = join(outputDirectory, ".work");
  const runner = new NodeProcessRunner();
  const probe = await probeMedia(sourcePath, runner, options.ffprobe);
  if (!probe.streams.some((stream) => stream.codec_type === "video"))
    throw new Error("Input media has no video stream");
  if (!probe.streams.some((stream) => stream.codec_type === "audio"))
    throw new Error("Input media has no audio stream");
  const renditions = await encodeAbrLadder(
    sourcePath,
    join(workDirectory, "video"),
    runner,
    options.ffmpeg,
  );
  const audioTracks = await extractAudioTracks(
    sourcePath,
    join(workDirectory, "audio"),
    probe,
    runner,
    options.ffmpeg,
  );
  let subtitleTracks = await extractSubtitleTracks(
    sourcePath,
    join(workDirectory, "subtitles"),
    probe,
    runner,
    options.ffmpeg,
    Boolean(options.subtitleEnrichment),
  );
  for (const [index, subtitle] of options.subtitles.entries()) {
    const language = normalizeLanguageTag(subtitle.language, `und-x-subtitle-${index + 1}`);
    const path = join(
      workDirectory,
      "subtitles",
      `external-${String(index + 1).padStart(2, "0")}-${language}.vtt`,
    );
    subtitleTracks.push(
      await convertSubtitleFile(
        resolve(subtitle.path),
        path,
        probe.format.duration,
        runner,
        options.ffmpeg,
        language,
        Boolean(options.subtitleEnrichment),
      ),
    );
  }
  if (subtitleTracks.length) {
    const jobs = z
      .array(SubtitleEnrichmentSchema)
      .parse(
        options.subtitleEnrichment
          ? JSON.parse(await readFile(options.subtitleEnrichment, "utf8"))
          : subtitleTracks.map(() => ({})),
      );
    if (jobs.length !== subtitleTracks.length)
      throw new Error("Supply one enrichment job per extracted/external subtitle track");
    const enriched = [];
    for (const [index, track] of subtitleTracks.entries())
      enriched.push(
        ...(await enrichSubtitleTrack(
          track,
          jobs[index],
          join(workDirectory, `enriched-${index}`),
          probe.format.duration,
        )),
      );
    subtitleTracks = enriched;
  }
  await packageHlsCmaf(
    outputDirectory,
    { renditions, audioTracks, subtitleTracks },
    probe.format.duration,
    runner,
    options.ffmpeg,
  );
  await generateThumbnails(
    sourcePath,
    join(outputDirectory, "thumbnails"),
    probe.format.duration,
    runner,
    options.ffmpeg,
  );
  const validationInput = {
    mediaRoot: outputDirectory,
    masterPlaylist: "master.m3u8",
    probeTarget: "master.m3u8",
    thumbnailVtt: "thumbnails/thumbnails.vtt",
    expectedDuration: probe.format.duration,
  };
  const probePackaged = (path: string) => probeMedia(path, runner, options.ffprobe);
  const validator = new MediaValidator({ probe: probePackaged });
  const report = await validator.validate(validationInput);
  if (!report.valid)
    throw new Error(
      `Packaged media failed validation: ${report.checks
        .filter((check) => check.status === "failed")
        .map((check) => check.message)
        .join("; ")}`,
    );
  await rm(workDirectory, { recursive: true, force: true });
  const descriptor = await writeMediaDescriptor(validationInput, report, { probe: probePackaged });
  return { outputDirectory, descriptor, validation: report };
}

function parseArguments(arguments_: string[]): ProcessVideoOptions {
  const values: {
    input?: string;
    subtitleEnrichment?: string;
    output?: string;
    subtitles: { language: string; path: string }[];
    ffmpeg?: string;
    ffprobe?: string;
  } = { subtitles: [] };
  for (let index = 0; index < arguments_.length; index++) {
    const flag = arguments_[index];
    const value = arguments_[++index];
    if (!value) throw new Error(`Missing value for ${flag}`);
    if (flag === "--input") values.input = value;
    else if (flag === "--subtitle-enrichment") values.subtitleEnrichment = value;
    else if (flag === "--output") values.output = value;
    else if (flag === "--ffmpeg") values.ffmpeg = value;
    else if (flag === "--ffprobe") values.ffprobe = value;
    else if (flag === "--subtitle") {
      const separator = value.indexOf("=");
      if (separator <= 0 || separator === value.length - 1)
        throw new Error("--subtitle must be LANGUAGE=PATH");
      values.subtitles.push({
        language: value.slice(0, separator),
        path: value.slice(separator + 1),
      });
    } else throw new Error(`Unknown option: ${flag}`);
  }
  return OptionsSchema.parse(values);
}

async function main(): Promise<void> {
  if (!process.argv.includes("--input") || !process.argv.includes("--output")) {
    throw new Error(
      "Usage: tsx pipeline/media/process.ts --input <media> --output <new-version-directory> [--subtitle language=path]",
    );
  }
  process.stdout.write(
    `${JSON.stringify(await processVideo(parseArguments(process.argv.slice(2))), null, 2)}\n`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  void main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
