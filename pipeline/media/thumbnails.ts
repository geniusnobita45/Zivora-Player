import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { formatWebVttTimestamp } from "./subtitles";
import { NodeProcessRunner, type CommandSpec, type ProcessRunner } from "./processRunner";

export const THUMBNAIL_INTERVAL_SECONDS = 5;
export const THUMBNAIL_WIDTH = 320;
export const THUMBNAIL_HEIGHT = 180;
export const SPRITE_COLUMNS = 10;
export const SPRITE_ROWS = 10;

export interface ThumbnailOutput {
  intervalSeconds: 5;
  width: 320;
  height: 180;
  frameCount: number;
  spriteCount: number;
  framesPattern: string;
  spritesPattern: string;
  vttPath: string;
}

const thumbnailFilter = `fps=1/${THUMBNAIL_INTERVAL_SECONDS},scale=${THUMBNAIL_WIDTH}:${THUMBNAIL_HEIGHT}:force_original_aspect_ratio=decrease,pad=${THUMBNAIL_WIDTH}:${THUMBNAIL_HEIGHT}:(ow-iw)/2:(oh-ih)/2:color=black`;

export function buildThumbnailCommands(
  inputPath: string,
  outputDirectory: string,
  ffmpegBinary = "ffmpeg",
): CommandSpec[] {
  return [
    {
      command: ffmpegBinary,
      args: [
        "-hide_banner",
        "-nostdin",
        "-y",
        "-i",
        inputPath,
        "-vf",
        thumbnailFilter,
        "-fps_mode",
        "vfr",
        "-q:v",
        "2",
        join(outputDirectory, "frames", "thumb-%06d.jpg"),
      ],
    },
    {
      command: ffmpegBinary,
      args: [
        "-hide_banner",
        "-nostdin",
        "-y",
        "-i",
        inputPath,
        "-vf",
        `${thumbnailFilter},tile=${SPRITE_COLUMNS}x${SPRITE_ROWS}:padding=0:margin=0`,
        "-fps_mode",
        "vfr",
        "-q:v",
        "2",
        join(outputDirectory, "sprites", "sprite-%04d.jpg"),
      ],
    },
  ];
}

export function createThumbnailWebVtt(duration: number, spriteBaseUri = "sprites"): string {
  const total = z.number().finite().positive().parse(duration);
  const frameCount = Math.ceil(total / THUMBNAIL_INTERVAL_SECONDS);
  const cues: string[] = [];
  for (let index = 0; index < frameCount; index++) {
    const start = index * THUMBNAIL_INTERVAL_SECONDS;
    const end = Math.min(total, start + THUMBNAIL_INTERVAL_SECONDS);
    const position = index % (SPRITE_COLUMNS * SPRITE_ROWS);
    const x = (position % SPRITE_COLUMNS) * THUMBNAIL_WIDTH;
    const y = Math.floor(position / SPRITE_COLUMNS) * THUMBNAIL_HEIGHT;
    const sprite = Math.floor(index / (SPRITE_COLUMNS * SPRITE_ROWS)) + 1;
    cues.push(
      `${formatWebVttTimestamp(start)} --> ${formatWebVttTimestamp(end)}\n${spriteBaseUri}/sprite-${String(sprite).padStart(4, "0")}.jpg#xywh=${x},${y},${THUMBNAIL_WIDTH},${THUMBNAIL_HEIGHT}`,
    );
  }
  return `WEBVTT\n\n${cues.join("\n\n")}\n`;
}

export async function generateThumbnails(
  inputPath: string,
  outputDirectory: string,
  duration: number,
  runner: ProcessRunner = new NodeProcessRunner(),
  ffmpegBinary = "ffmpeg",
): Promise<ThumbnailOutput> {
  const total = z.number().finite().positive().parse(duration);
  await mkdir(join(outputDirectory, "frames"), { recursive: true });
  await mkdir(join(outputDirectory, "sprites"), { recursive: true });
  for (const command of buildThumbnailCommands(inputPath, outputDirectory, ffmpegBinary))
    await runner.run(command);
  const vttPath = join(outputDirectory, "thumbnails.vtt");
  await writeFile(vttPath, createThumbnailWebVtt(total), "utf8");
  const frameCount = Math.ceil(total / THUMBNAIL_INTERVAL_SECONDS);
  return {
    intervalSeconds: 5,
    width: 320,
    height: 180,
    frameCount,
    spriteCount: Math.ceil(frameCount / (SPRITE_COLUMNS * SPRITE_ROWS)),
    framesPattern: join(outputDirectory, "frames", "thumb-%06d.jpg"),
    spritesPattern: join(outputDirectory, "sprites", "sprite-%04d.jpg"),
    vttPath,
  };
}

async function main(): Promise<void> {
  const [inputPath, outputDirectory, durationInput] = process.argv.slice(2);
  if (!inputPath || !outputDirectory || !durationInput)
    throw new Error(
      "Usage: tsx pipeline/media/thumbnails.ts <input-media> <output-directory> <duration-seconds>",
    );
  process.stdout.write(
    `${JSON.stringify(await generateThumbnails(inputPath, outputDirectory, z.coerce.number().positive().parse(durationInput)), null, 2)}\n`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  void main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
