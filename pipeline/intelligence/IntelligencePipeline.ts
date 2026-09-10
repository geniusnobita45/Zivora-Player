import { resolve } from "node:path";
import { z, type ZodType } from "zod";
import type { AIProvider } from "@/features/ai/gateway/AIProvider";
import type { ProcessRunner } from "@/pipeline/media/processRunner";
import {
  CheckpointStore,
  IntelligenceStageSchema,
  type IntelligenceStage,
} from "./CheckpointStore";
import type { IntelligenceRepository } from "./IntelligenceRepository";
import { transcribeMedia } from "./transcription";
import { detectScenes } from "./scenes";
import { extractCharacters } from "./characters";
import { generateEmbeddings } from "./embeddings";
import { generateChapters } from "./chapters";
import { generateRecaps } from "./recaps";
import { detectSkipSegments, EpisodeFingerprintSchema } from "./skip-detection";
import {
  CharacterSchema,
  ChapterSchema,
  RecapSchema,
  SceneSchema,
  SkipSegmentSchema,
  TranscriptionSchema,
} from "./types";

const OptionsSchema = z
  .object({
    mediaVersionId: z.string().uuid(),
    contentId: z.string().uuid(),
    mediaPath: z.string().min(1),
    checkpointPath: z.string().min(1),
    language: z.string().min(1).optional(),
    relatedFingerprints: z.array(EpisodeFingerprintSchema).default([]),
  })
  .strict();
export type IntelligencePipelineOptions = z.input<typeof OptionsSchema>;
const transcriptionOutput = TranscriptionSchema.extend({
  segments: z.array(
    z
      .object({
        id: z.string().uuid(),
        index: z.number().int().nonnegative(),
        start: z.number().finite().min(0).max(86400),
        end: z.number().finite().min(0).max(86400),
        text: z.string().trim().min(1).max(10000),
        speaker: z.string().trim().min(1).max(200).nullable(),
        confidence: z.number().min(0).max(1).nullable(),
      })
      .strict()
      .refine((segment) => segment.end > segment.start),
  ),
  provider: z.string().min(1),
  model: z.string().min(1),
  sourceChecksum: z.string().regex(/^[a-f0-9]{64}$/),
  transcriptId: z.string().uuid(),
});
export class IntelligencePipeline {
  constructor(
    private readonly provider: AIProvider,
    private readonly runner: ProcessRunner,
    private readonly repository: IntelligenceRepository,
  ) {}
  async run(input: IntelligencePipelineOptions) {
    const options = OptionsSchema.parse(input);
    const checkpoint = new CheckpointStore(resolve(options.checkpointPath), options.mediaVersionId);
    await this.repository.setContentState(options.contentId, "AI_PROCESSING");
    const stage = async <T>(
      name: IntelligenceStage,
      schema: ZodType<T>,
      execute: () => Promise<T>,
    ) => {
      const saved = (await checkpoint.load()).completed[name];
      if (saved !== undefined) {
        const value = schema.parse(saved);
        await this.repository.saveStage(options.mediaVersionId, options.contentId, name, value);
        return value;
      }
      await checkpoint.attempted(name);
      const value = schema.parse(await execute());
      await this.repository.saveStage(options.mediaVersionId, options.contentId, name, value);
      await checkpoint.complete(name, value);
      return value;
    };
    const transcription = await stage("transcription", transcriptionOutput, async () => ({
      ...(await transcribeMedia(
        this.provider,
        options.mediaVersionId,
        options.mediaPath,
        options.language,
      )),
      transcriptId: (await import("./types")).stableUuid(options.mediaVersionId, "transcript"),
    }));
    const scenes = await stage("scenes", z.array(SceneSchema), () =>
      detectScenes(
        this.provider,
        this.runner,
        options.mediaPath,
        transcription,
        options.mediaVersionId,
      ),
    );
    const characters = await stage("characters", z.array(CharacterSchema), () =>
      extractCharacters(this.provider, options.contentId, scenes, transcription),
    );
    const embeddings = await stage(
      "embeddings",
      z.array(
        z.object({
          id: z.string().uuid(),
          source: z.enum(["scene", "transcript"]),
          sourceId: z.string().uuid(),
          model: z.string().min(1),
          embedding: z.array(z.number()).length(1536),
        }),
      ),
      () => generateEmbeddings(this.provider, options.mediaVersionId, scenes, transcription),
    );
    const chapters = await stage("chapters", z.array(ChapterSchema), () =>
      generateChapters(this.provider, options.mediaVersionId, scenes),
    );
    const recaps = await stage("recaps", z.array(RecapSchema), () =>
      generateRecaps(this.provider, options.mediaVersionId, scenes, transcription),
    );
    const skips = await stage(
      "skip-detection",
      z.object({
        segments: z.array(SkipSegmentSchema),
        fingerprints: z.array(EpisodeFingerprintSchema),
      }),
      () =>
        detectSkipSegments(
          this.runner,
          options.mediaVersionId,
          options.mediaPath,
          transcription.duration,
          options.relatedFingerprints,
        ),
    );
    return {
      transcription,
      scenes,
      characters,
      embeddings,
      chapters,
      recaps,
      skips,
      stages: IntelligenceStageSchema.options,
    };
  }
}
