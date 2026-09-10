import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { probeMedia, type ProbeResult } from "./probe";
import { NodeProcessRunner, type CommandSpec, type ProcessRunner } from "./processRunner";

export const AbrRenditionSchema = z
  .object({
    id: z.enum(["1080p", "720p", "480p", "360p"]),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    videoBitrate: z.number().int().positive(),
    maxRate: z.number().int().positive(),
    bufferSize: z.number().int().positive(),
    profile: z.enum(["high", "main"]),
    level: z.string().regex(/^\d(?:\.\d)?$/),
  })
  .strict();

export type AbrRendition = z.infer<typeof AbrRenditionSchema>;

export const ABR_LADDER: readonly AbrRendition[] = Object.freeze([
  {
    id: "1080p",
    width: 1920,
    height: 1080,
    videoBitrate: 5_000_000,
    maxRate: 5_350_000,
    bufferSize: 7_500_000,
    profile: "high",
    level: "4.0",
  },
  {
    id: "720p",
    width: 1280,
    height: 720,
    videoBitrate: 2_800_000,
    maxRate: 2_996_000,
    bufferSize: 4_200_000,
    profile: "high",
    level: "3.1",
  },
  {
    id: "480p",
    width: 854,
    height: 480,
    videoBitrate: 1_400_000,
    maxRate: 1_498_000,
    bufferSize: 2_100_000,
    profile: "main",
    level: "3.0",
  },
  {
    id: "360p",
    width: 640,
    height: 360,
    videoBitrate: 800_000,
    maxRate: 856_000,
    bufferSize: 1_200_000,
    profile: "main",
    level: "3.0",
  },
] satisfies readonly AbrRendition[]);

export interface EncodedRendition extends AbrRendition {
  path: string;
  codec: "h264";
  keyframeIntervalSeconds: 2;
}

export function buildVideoEncodeCommand(
  inputPath: string,
  outputPath: string,
  rendition: AbrRendition,
  ffmpegBinary = "ffmpeg",
): CommandSpec {
  const value = AbrRenditionSchema.parse(rendition);
  return {
    command: ffmpegBinary,
    args: [
      "-hide_banner",
      "-nostdin",
      "-y",
      "-i",
      inputPath,
      "-map",
      "0:v:0",
      "-an",
      "-sn",
      "-dn",
      "-vf",
      `scale=${value.width}:${value.height}:force_original_aspect_ratio=decrease,pad=${value.width}:${value.height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1`,
      "-c:v",
      "libx264",
      "-preset",
      "slow",
      "-profile:v",
      value.profile,
      "-level:v",
      value.level,
      "-pix_fmt",
      "yuv420p",
      "-b:v",
      String(value.videoBitrate),
      "-maxrate",
      String(value.maxRate),
      "-bufsize",
      String(value.bufferSize),
      "-sc_threshold",
      "0",
      "-force_key_frames",
      "expr:gte(t,n_forced*2)",
      "-movflags",
      "+faststart",
      "-map_metadata",
      "-1",
      outputPath,
    ],
  };
}

export async function encodeAbrLadder(
  inputPath: string,
  outputDirectory: string,
  runner: ProcessRunner = new NodeProcessRunner(),
  ffmpegBinary = "ffmpeg",
): Promise<EncodedRendition[]> {
  z.string().trim().min(1).parse(inputPath);
  z.string().trim().min(1).parse(outputDirectory);
  await mkdir(outputDirectory, { recursive: true });
  const outputs: EncodedRendition[] = [];
  for (const rendition of ABR_LADDER) {
    const path = join(outputDirectory, `${rendition.id}.mp4`);
    await runner.run(buildVideoEncodeCommand(inputPath, path, rendition, ffmpegBinary));
    outputs.push({ ...rendition, path, codec: "h264", keyframeIntervalSeconds: 2 });
  }
  return outputs;
}

function concatPath(path: string): string {
  const absolute = isAbsolute(path) ? path : resolve(path);
  return absolute.replaceAll("'", "'\\''");
}

export function buildLosslessMergeCommand(
  concatListPath: string,
  outputPath: string,
  ffmpegBinary = "ffmpeg",
): CommandSpec {
  return {
    command: ffmpegBinary,
    args: [
      "-hide_banner",
      "-nostdin",
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      concatListPath,
      "-map",
      "0",
      "-c",
      "copy",
      "-map_metadata",
      "-1",
      outputPath,
    ],
  };
}

export async function losslessMerge(
  inputs: readonly string[],
  outputPath: string,
  runner: ProcessRunner = new NodeProcessRunner(),
  ffmpegBinary = "ffmpeg",
): Promise<void> {
  const files = z.array(z.string().trim().min(1)).min(2).parse(inputs);
  z.string().trim().min(1).parse(outputPath);
  await mkdir(dirname(outputPath), { recursive: true });
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "zivora-concat-"));
  const concatListPath = join(temporaryDirectory, "concat.txt");
  try {
    await writeFile(
      concatListPath,
      `${files.map((path) => `file '${concatPath(path)}'`).join("\n")}\n`,
      { encoding: "utf8", flag: "wx" },
    );
    await runner.run(buildLosslessMergeCommand(concatListPath, outputPath, ffmpegBinary));
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const [inputPath, outputDirectory] = process.argv.slice(2);
  if (!inputPath || !outputDirectory)
    throw new Error("Usage: tsx pipeline/media/encode.ts <input-media> <output-directory>");
  const probe: ProbeResult = await probeMedia(inputPath);
  if (!probe.streams.some((stream) => stream.codec_type === "video"))
    throw new Error("Input has no video stream");
  process.stdout.write(
    `${JSON.stringify(await encodeAbrLadder(inputPath, outputDirectory), null, 2)}\n`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  void main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
