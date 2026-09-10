import { appendFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import type { IngestStage } from "./types";

const LogEventSchema = z
  .object({
    at: z.string().datetime(),
    event: z.enum(["start", "complete", "skip", "fail", "state"]),
    stage: z.string().optional(),
    durationMs: z.number().nonnegative().optional(),
    state: z.string().optional(),
    error: z.string().optional(),
  })
  .strict();
export type IngestLogEvent = z.infer<typeof LogEventSchema>;

export class IngestLogger {
  readonly path: string;
  constructor(path: string) {
    this.path = resolve(z.string().trim().min(1).parse(path));
  }
  async init(): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await appendFile(this.path, "", "utf8");
  }
  async event(event: IngestLogEvent): Promise<void> {
    const value = LogEventSchema.parse(event);
    await appendFile(this.path, `${JSON.stringify(value)}\n`, "utf8");
    if (value.event === "start") process.stdout.write(`→ ${value.stage}\n`);
    if (value.event === "complete")
      process.stdout.write(`✓ ${value.stage} (${value.durationMs}ms)\n`);
    if (value.event === "skip") process.stdout.write(`· ${value.stage} (skipped)\n`);
    if (value.event === "fail") process.stderr.write(`✗ ${value.stage}: ${value.error}\n`);
  }
  async stage<T>(stage: IngestStage, operation: () => Promise<T>): Promise<T> {
    const started = Date.now();
    await this.event({ at: new Date().toISOString(), event: "start", stage });
    try {
      const value = await operation();
      await this.event({
        at: new Date().toISOString(),
        event: "complete",
        stage,
        durationMs: Date.now() - started,
      });
      return value;
    } catch (error) {
      await this.event({
        at: new Date().toISOString(),
        event: "fail",
        stage,
        durationMs: Date.now() - started,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
