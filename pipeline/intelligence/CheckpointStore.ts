import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { z } from "zod";

export const IntelligenceStageSchema = z.enum([
  "transcription",
  "scenes",
  "characters",
  "embeddings",
  "chapters",
  "recaps",
  "skip-detection",
]);
export type IntelligenceStage = z.infer<typeof IntelligenceStageSchema>;
const CheckpointSchema = z
  .object({
    mediaVersionId: z.string().uuid(),
    completed: z.record(IntelligenceStageSchema, z.unknown()),
    attempts: z.record(IntelligenceStageSchema, z.number().int().nonnegative()).default({}),
    updatedAt: z.string().datetime(),
  })
  .strict();
export type IntelligenceCheckpoint = z.infer<typeof CheckpointSchema>;
export class CheckpointStore {
  readonly path: string;
  constructor(
    path: string,
    private readonly mediaVersionId: string,
  ) {
    this.path = resolve(z.string().min(1).parse(path));
    z.string().uuid().parse(mediaVersionId);
  }
  async load(): Promise<IntelligenceCheckpoint> {
    try {
      return CheckpointSchema.parse(JSON.parse(await readFile(this.path, "utf8")));
    } catch {
      return {
        mediaVersionId: this.mediaVersionId,
        completed: {},
        attempts: {},
        updatedAt: new Date(0).toISOString(),
      };
    }
  }
  async complete(stage: IntelligenceStage, value: unknown) {
    const current = await this.load();
    current.completed[stage] = value;
    current.updatedAt = new Date().toISOString();
    await this.write(current);
  }
  async attempted(stage: IntelligenceStage) {
    const current = await this.load();
    current.attempts[stage] = (current.attempts[stage] ?? 0) + 1;
    current.updatedAt = new Date().toISOString();
    await this.write(current);
  }
  private async write(value: IntelligenceCheckpoint) {
    const parsed = CheckpointSchema.parse(value);
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(parsed, null, 2), { encoding: "utf8", flag: "w" });
    await rename(temporary, this.path);
  }
}
