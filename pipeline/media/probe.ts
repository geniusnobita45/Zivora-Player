import { fileURLToPath } from "node:url";
import { z } from "zod";
import { NodeProcessRunner, type ProcessRunner } from "./processRunner";

const NumberTextSchema = z.union([z.string(), z.number()]).transform((value, context) => {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Expected a finite number" });
    return z.NEVER;
  }
  return number;
});

const IntegerTextSchema = NumberTextSchema.pipe(z.number().int().nonnegative());
const TagsSchema = z.record(z.string()).default({});

export const ProbeStreamSchema = z
  .object({
    index: z.number().int().nonnegative(),
    codec_name: z.string().min(1),
    codec_type: z.enum(["video", "audio", "subtitle", "data", "attachment", "unknown"]),
    codec_long_name: z.string().optional(),
    profile: z.string().optional(),
    width: IntegerTextSchema.optional(),
    height: IntegerTextSchema.optional(),
    pix_fmt: z.string().optional(),
    sample_rate: IntegerTextSchema.optional(),
    channels: IntegerTextSchema.optional(),
    channel_layout: z.string().optional(),
    bit_rate: IntegerTextSchema.optional(),
    duration: NumberTextSchema.pipe(z.number().nonnegative()).optional(),
    avg_frame_rate: z.string().optional(),
    r_frame_rate: z.string().optional(),
    tags: TagsSchema,
    disposition: z.record(z.union([z.number(), z.boolean()])).default({}),
  })
  .passthrough();

export const ProbeFormatSchema = z
  .object({
    filename: z.string().optional(),
    format_name: z.string().min(1),
    format_long_name: z.string().optional(),
    start_time: NumberTextSchema.optional(),
    duration: NumberTextSchema.pipe(z.number().positive()),
    size: IntegerTextSchema.optional(),
    bit_rate: IntegerTextSchema.optional(),
    tags: TagsSchema,
  })
  .passthrough();

export const ProbeResultSchema = z
  .object({
    streams: z.array(ProbeStreamSchema).min(1),
    format: ProbeFormatSchema,
  })
  .strict();

export type ProbeStream = z.infer<typeof ProbeStreamSchema>;
export type ProbeResult = z.infer<typeof ProbeResultSchema>;

export function parseProbeResult(input: unknown): ProbeResult {
  return ProbeResultSchema.parse(input);
}

export async function probeMedia(
  inputPath: string,
  runner: ProcessRunner = new NodeProcessRunner(),
  ffprobeBinary = "ffprobe",
): Promise<ProbeResult> {
  const path = z.string().trim().min(1).parse(inputPath);
  const result = await runner.run({
    command: ffprobeBinary,
    args: ["-v", "error", "-show_streams", "-show_format", "-of", "json", path],
  });
  let json: unknown;
  try {
    json = JSON.parse(result.stdout);
  } catch (cause) {
    throw new Error("FFprobe returned invalid JSON", { cause });
  }
  return parseProbeResult(json);
}

async function main(): Promise<void> {
  const input = process.argv[2];
  if (!input) throw new Error("Usage: tsx pipeline/media/probe.ts <input-media>");
  process.stdout.write(`${JSON.stringify(await probeMedia(input), null, 2)}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  void main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
