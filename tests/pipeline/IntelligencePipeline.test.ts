// @vitest-environment node
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AIProvider, StructuredRequest } from "@/features/ai/gateway/AIProvider";
import type { ProcessRunner } from "@/pipeline/media/processRunner";
import { IntelligencePipeline } from "@/pipeline/intelligence/IntelligencePipeline";
import type { IntelligenceRepository } from "@/pipeline/intelligence/IntelligenceRepository";

const mediaVersionId = "11111111-1111-4111-8111-111111111111";
const contentId = "22222222-2222-4222-8222-222222222222";
const fingerprint = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

class FixtureProvider implements AIProvider {
  readonly name = "fixture";
  readonly model = "fixture-generation-v1";
  readonly embeddingModel = "fixture-embedding-1536-v1";
  readonly generateCalls: string[] = [];
  transcribe = vi.fn(async () => ({
    language: "en",
    duration: 120,
    segments: [
      { start: 0, end: 60, text: "Alice arrives.", speaker: "Alice", confidence: 0.98 },
      { start: 60, end: 120, text: "Alice leaves.", speaker: "Alice", confidence: 0.97 },
    ],
  }));
  embed = vi.fn(async ({ inputs }: { inputs: readonly string[] }) =>
    inputs.map((_, index) =>
      Array.from({ length: 1536 }, (__, dimension) => index + dimension / 1536),
    ),
  );
  vision<T>(): Promise<T> {
    throw new Error("Vision is not needed by this fixture");
  }
  async generate<T>(request: StructuredRequest<T>): Promise<T> {
    this.generateCalls.push(request.schemaName);
    const outputs: Record<string, unknown> = {
      zivora_scenes_v1: {
        boundaries: [60],
        scenes: [
          { start: 0, end: 60, title: "Arrival", summary: "Alice arrives." },
          { start: 60, end: 120, title: "Departure", summary: "Alice leaves." },
        ],
      },
      zivora_characters_v1: {
        characters: [
          {
            name: "Alice",
            description: "The principal character.",
            aliases: [],
            firstAppearance: 0,
            sceneIndexes: [0, 1],
          },
        ],
      },
      zivora_chapters_v1: {
        chapters: [{ start: 0, end: 120, title: "Journey", summary: "Arrival and departure." }],
      },
      zivora_recaps_v1: {
        segments: [
          { kind: "episode", start: 0, end: 120, summary: "Alice arrives, then leaves." },
          { kind: "what_did_i_miss", start: 0, end: 60, summary: "Alice arrived." },
        ],
      },
    };
    return request.schema.parse(outputs[request.schemaName]);
  }
}

describe("intelligence ingestion", () => {
  it("checkpoints every stage and resumes without repeating intelligence cost", async () => {
    const directory = await mkdtemp(join(tmpdir(), "zivora-intelligence-"));
    directories.push(directory);
    const mediaPath = join(directory, "episode.mp4");
    const checkpointPath = join(directory, "checkpoint.json");
    await writeFile(mediaPath, "immutable fixture bytes");
    const provider = new FixtureProvider();
    const runner: ProcessRunner = {
      run: vi.fn(async (spec) => {
        if (spec.args.includes("select='gt(scene,0.35)',showinfo"))
          return { stdout: "", stderr: "showinfo pts_time:60", exitCode: 0 };
        if (spec.args.includes("blackdetect=d=0.5:pix_th=0.10"))
          return { stdout: "", stderr: "black_start:105 black_end:120", exitCode: 0 };
        return { stdout: fingerprint, stderr: "", exitCode: 0 };
      }),
    };
    const saved: string[] = [];
    const repository: IntelligenceRepository = {
      setContentState: vi.fn(async () => undefined),
      saveStage: vi.fn(async (_version, _content, stage) => {
        saved.push(stage);
      }),
    };
    const pipeline = new IntelligencePipeline(provider, runner, repository);
    const options = {
      mediaVersionId,
      contentId,
      mediaPath,
      checkpointPath,
      relatedFingerprints: [{ position: "opening" as const, fingerprint }],
    };

    const first = await pipeline.run(options);
    expect(first.scenes).toHaveLength(2);
    expect(first.embeddings).toHaveLength(4);
    expect(first.skips.segments.map((segment) => segment.kind)).toEqual(["intro", "credits"]);
    expect(saved).toEqual(first.stages);
    const costs = {
      generated: provider.generateCalls.length,
      embedded: provider.embed.mock.calls.length,
      transcribed: provider.transcribe.mock.calls.length,
      ffmpeg: vi.mocked(runner.run).mock.calls.length,
    };

    const second = await pipeline.run(options);
    expect(second).toEqual(first);
    expect(saved).toHaveLength(14);
    expect(provider.generateCalls).toHaveLength(costs.generated);
    expect(provider.embed).toHaveBeenCalledTimes(costs.embedded);
    expect(provider.transcribe).toHaveBeenCalledTimes(costs.transcribed);
    expect(runner.run).toHaveBeenCalledTimes(costs.ffmpeg);
    const checkpoint = JSON.parse(await readFile(checkpointPath, "utf8")) as unknown;
    expect(checkpoint).toMatchObject({ mediaVersionId });
    expect(repository.setContentState).toHaveBeenCalledWith(contentId, "AI_PROCESSING");
  });

  it("rejects malformed provider embeddings before persistence", async () => {
    const directory = await mkdtemp(join(tmpdir(), "zivora-intelligence-invalid-"));
    directories.push(directory);
    const mediaPath = join(directory, "episode.mp4");
    await writeFile(mediaPath, "fixture");
    const provider = new FixtureProvider();
    provider.embed.mockResolvedValue([[1, 2, 3]]);
    const runner: ProcessRunner = {
      run: async (spec) =>
        spec.args.includes("select='gt(scene,0.35)',showinfo")
          ? { stdout: "", stderr: "showinfo pts_time:60", exitCode: 0 }
          : { stdout: fingerprint, stderr: "", exitCode: 0 },
    };
    const repository: IntelligenceRepository = {
      setContentState: async () => undefined,
      saveStage: vi.fn(async () => undefined),
    };
    const pipeline = new IntelligencePipeline(provider, runner, repository);
    await expect(
      pipeline.run({
        mediaVersionId,
        contentId,
        mediaPath,
        checkpointPath: join(directory, "cp.json"),
      }),
    ).rejects.toMatchObject({ name: "ZodError" });
    expect(repository.saveStage).not.toHaveBeenCalledWith(
      mediaVersionId,
      contentId,
      "embeddings",
      expect.anything(),
    );
  });
});
