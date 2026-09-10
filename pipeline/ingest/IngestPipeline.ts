import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { ABR_LADDER, encodeAbrLadder, type EncodedRendition } from "@/pipeline/media/encode";
import { extractAudioTracks, type ExtractedAudioTrack } from "@/pipeline/media/audio";
import {
  extractSubtitleTracks,
  convertSubtitleFile,
  type ConvertedSubtitleTrack,
} from "@/pipeline/media/subtitles";
import { packageHlsCmaf } from "@/pipeline/media/package";
import { generateThumbnails } from "@/pipeline/media/thumbnails";
import { probeMedia, type ProbeResult } from "@/pipeline/media/probe";
import type { ProcessRunner } from "@/pipeline/media/processRunner";
import { NodeProcessRunner } from "@/pipeline/media/processRunner";
import {
  MediaValidator,
  writeMediaDescriptor,
  ZivoraMediaDescriptorSchema,
  type MediaValidationReport,
  type ZivoraMediaDescriptor,
} from "@/pipeline/validation/MediaValidator";
import { IntelligencePipeline } from "@/pipeline/intelligence/IntelligencePipeline";
import type { AIProvider } from "@/features/ai/gateway/AIProvider";
import type { IntelligenceRepository } from "@/pipeline/intelligence/IntelligenceRepository";
import { VersionManager, type AllocatedVersion } from "@/pipeline/publish/VersionManager";
import { Publisher } from "@/pipeline/publish/Publisher";
import { IngestLogger } from "./IngestLogger";
import { IngestOptionsSchema, type IngestReport, type IngestStage } from "./types";

export interface IngestStateStore {
  setContentState(
    contentId: string,
    state: "UPLOADED" | "PROCESSING" | "AI_PROCESSING" | "VALIDATING" | "READY" | "FAILED",
  ): Promise<void>;
}

export interface IngestDependencies {
  runner?: ProcessRunner;
  provider?: AIProvider;
  state?: IngestStateStore;
  versionManager?: VersionManager;
  publisher?: Publisher;
  intelligenceRepository?: IntelligenceRepository;
  now?: () => number;
}

interface Context {
  probe?: ProbeResult;
  renditions?: EncodedRendition[];
  audioTracks?: ExtractedAudioTrack[];
  subtitleTracks?: ConvertedSubtitleTrack[];
  descriptor?: ZivoraMediaDescriptor;
  validation?: MediaValidationReport;
  version?: AllocatedVersion;
}

const AI_STAGES = new Set<IngestStage>([
  "TRANSCRIBE",
  "SCENES",
  "CHARACTERS",
  "EMBEDDINGS",
  "CHAPTERS",
  "RECAPS",
  "SKIP MARKERS",
]);
const ORDER: readonly IngestStage[] = [
  "PROBE",
  "VALIDATE",
  "TRANSCODE",
  "PACKAGE",
  "THUMBNAILS",
  "SUBTITLES",
  "TRANSCRIBE",
  "SCENES",
  "CHARACTERS",
  "EMBEDDINGS",
  "CHAPTERS",
  "RECAPS",
  "SKIP MARKERS",
  "UPLOAD NEW MEDIA VERSION",
  "VALIDATE CLOUD MEDIA",
  "TEST PLAYBACK",
  "REGISTER DATABASE",
  "ATOMIC PUBLISH",
  "READY",
];

function sourceValidation(probe: ProbeResult): void {
  const video = probe.streams.filter((stream) => stream.codec_type === "video");
  const audio = probe.streams.filter((stream) => stream.codec_type === "audio");
  if (
    !video.length ||
    video.some(
      (stream) => !["h264", "hevc", "vp9", "av1"].includes(stream.codec_name.toLowerCase()),
    )
  )
    throw new Error("Input must contain a supported video stream");
  if (!audio.length) throw new Error("Input must contain an audio stream");
  if (probe.format.duration > 86400) throw new Error("Media duration exceeds 24 hours");
}

export class IngestPipeline {
  private readonly runner: ProcessRunner;
  private readonly now: () => number;
  constructor(private readonly dependencies: IngestDependencies = {}) {
    this.runner = dependencies.runner ?? new NodeProcessRunner();
    this.now = dependencies.now ?? Date.now;
  }

  async run(input: unknown): Promise<IngestReport> {
    const options = IngestOptionsSchema.parse(input);
    const started = this.now();
    const outputDirectory = resolve(
      options.output ??
        join(dirname(resolve(options.input)), `.zivora-${options.contentId}-${Date.now()}`),
    );
    const logPath = resolve(options.logPath ?? join(outputDirectory, "zivora-ingest.log.jsonl"));
    const reportPath = join(outputDirectory, "zivora-ingest-report.json");
    const logger = new IngestLogger(logPath);
    await mkdir(outputDirectory, { recursive: true });
    await logger.init();
    const completedStages: IngestStage[] = [];
    const context: Context = {};
    const fromIndex = options.from ? ORDER.indexOf(options.from) : 0;
    if (fromIndex < 0) throw new Error(`Unknown ingest stage: ${options.from}`);
    const shouldRun = (stage: IngestStage) => ORDER.indexOf(stage) >= fromIndex;
    const resumingAiOrPublication = fromIndex >= ORDER.indexOf("TRANSCRIBE");
    const state = async (
      value: "UPLOADED" | "PROCESSING" | "AI_PROCESSING" | "VALIDATING" | "READY" | "FAILED",
    ) => {
      await logger.event({ at: new Date().toISOString(), event: "state", state: value });
      if (!options.dryRun) await this.dependencies.state?.setContentState(options.contentId, value);
    };
    let activeStage: IngestStage = "PROBE";
    const stage = async <T>(
      name: IngestStage,
      operation: () => Promise<T>,
      skip = false,
    ): Promise<T | undefined> => {
      if (!shouldRun(name) || skip) {
        await logger.event({ at: new Date().toISOString(), event: "skip", stage: name });
        return undefined;
      }
      activeStage = name;
      const result = await logger.stage(name, operation);
      completedStages.push(name);
      return result;
    };
    let failedStage: IngestStage | null = null;
    try {
      await state("UPLOADED");
      if (fromIndex > 0) {
        context.probe = await probeMedia(options.input, this.runner, options.ffprobe);
        if (!resumingAiOrPublication && fromIndex > ORDER.indexOf("TRANSCODE")) {
          context.renditions = ABR_LADDER.map((rendition) => ({
            ...rendition,
            path: join(outputDirectory, "work", "video", `${rendition.id}.mp4`),
            codec: "h264" as const,
            keyframeIntervalSeconds: 2 as const,
          }));
          context.audioTracks = await extractAudioTracks(
            options.input,
            join(outputDirectory, "work", "audio"),
            context.probe,
            this.runner,
            options.ffmpeg,
          );
        }
      }
      if (resumingAiOrPublication) {
        context.descriptor = ZivoraMediaDescriptorSchema.parse(
          JSON.parse(await readFile(join(outputDirectory, "zivora-media.json"), "utf8")),
        );
      }
      const stagedProbe = (await stage("PROBE", () =>
        probeMedia(options.input, this.runner, options.ffprobe),
      )) as ProbeResult | undefined;
      if (stagedProbe) context.probe = stagedProbe;
      if (!context.probe)
        context.probe = await probeMedia(options.input, this.runner, options.ffprobe);
      if (!context.probe && !options.from) throw new Error("Probe stage produced no result");
      await stage("VALIDATE", async () => sourceValidation(context.probe!));
      await state("PROCESSING");
      if (!resumingAiOrPublication) {
        if (shouldRun("TRANSCODE"))
          context.renditions = (await stage("TRANSCODE", () =>
            encodeAbrLadder(
              options.input,
              join(outputDirectory, "work", "video"),
              this.runner,
              options.ffmpeg,
            ),
          )) as EncodedRendition[] | undefined;
        if (shouldRun("TRANSCODE"))
          context.audioTracks = context.probe
            ? await extractAudioTracks(
                options.input,
                join(outputDirectory, "work", "audio"),
                context.probe,
                this.runner,
                options.ffmpeg,
              )
            : undefined;
        if (shouldRun("PACKAGE"))
          await stage("PACKAGE", async () => {
            await packageHlsCmaf(
              outputDirectory,
              {
                renditions: context.renditions!,
                audioTracks: context.audioTracks!,
                subtitleTracks: [],
              },
              context.probe!.format.duration,
              this.runner,
              options.ffmpeg,
            );
          });
        await stage("THUMBNAILS", () =>
          generateThumbnails(
            options.input,
            join(outputDirectory, "thumbnails"),
            context.probe!.format.duration,
            this.runner,
            options.ffmpeg,
          ),
        );
      }
      context.subtitleTracks = resumingAiOrPublication
        ? undefined
        : ((await stage("SUBTITLES", async () => {
            const tracks = context.probe
              ? await extractSubtitleTracks(
                  options.input,
                  join(outputDirectory, "work", "subtitles"),
                  context.probe,
                  this.runner,
                  options.ffmpeg,
                )
              : [];
            for (const [index, subtitle] of options.subtitles.entries())
              tracks.push(
                await convertSubtitleFile(
                  resolve(subtitle.path),
                  join(outputDirectory, "work", "subtitles", `external-${index + 1}.vtt`),
                  context.probe!.format.duration,
                  this.runner,
                  options.ffmpeg,
                  subtitle.language,
                ),
              );
            await packageHlsCmaf(
              outputDirectory,
              {
                renditions: context.renditions!,
                audioTracks: context.audioTracks!,
                subtitleTracks: tracks,
              },
              context.probe!.format.duration,
              this.runner,
              options.ffmpeg,
            );
            return tracks;
          })) as ConvertedSubtitleTrack[] | undefined);
      if (!options.skipAi) {
        await state("AI_PROCESSING");
        if (!this.dependencies.provider)
          throw new Error("AI provider is required unless --skip-ai is used");
        if (!this.dependencies.versionManager)
          throw new Error("Version manager is required for AI ingestion");
        context.version = await this.dependencies.versionManager.allocate({
          contentId: options.contentId,
          episodeId: options.episodeId,
        });
        const intelligence = new IntelligencePipeline(
          this.dependencies.provider,
          this.runner,
          this.dependencies.intelligenceRepository ?? {
            setContentState: async () => undefined,
            saveStage: async () => undefined,
          },
        );
        await intelligence.run({
          mediaVersionId: context.version.id,
          contentId: options.contentId,
          mediaPath: options.input,
          checkpointPath:
            options.checkpointPath ?? join(outputDirectory, "intelligence-checkpoint.json"),
        });
      }
      for (const aiStage of AI_STAGES) await stage(aiStage, async () => undefined, options.skipAi);
      await state("VALIDATING");
      activeStage = "VALIDATE CLOUD MEDIA";
      context.validation = resumingAiOrPublication
        ? {
            valid: true,
            mediaRoot: outputDirectory,
            masterPlaylist: "master.m3u8",
            checkedAt: new Date().toISOString(),
            checks: [],
          }
        : await new MediaValidator({ probe: async () => context.probe! }).validate({
            mediaRoot: outputDirectory,
            masterPlaylist: "master.m3u8",
            probeTarget: "master.m3u8",
            thumbnailVtt: "thumbnails/thumbnails.vtt",
            expectedDuration: context.probe!.format.duration,
          });
      if (!context.validation?.valid) throw new Error("Local media validation failed");
      if (!context.descriptor)
        context.descriptor = await writeMediaDescriptor(
          {
            mediaRoot: outputDirectory,
            masterPlaylist: "master.m3u8",
            probeTarget: "master.m3u8",
            thumbnailVtt: "thumbnails/thumbnails.vtt",
            expectedDuration: context.probe!.format.duration,
          },
          context.validation,
          { probe: async () => context.probe! },
        );
      if (!options.dryRun) {
        if (!context.version && this.dependencies.versionManager)
          context.version = await this.dependencies.versionManager.allocate({
            contentId: options.contentId,
            episodeId: options.episodeId,
          });
        if (!context.version || !this.dependencies.publisher)
          throw new Error("Publisher and version manager are required");
        activeStage = "UPLOAD NEW MEDIA VERSION";
        await this.dependencies.publisher!.publishReserved(
          { directory: outputDirectory, version: context.version! },
          {
            uploaded: () => {
              activeStage = "UPLOAD NEW MEDIA VERSION";
              return stage("UPLOAD NEW MEDIA VERSION", async () => undefined).then(() => undefined);
            },
            cloudValidated: () => {
              activeStage = "VALIDATE CLOUD MEDIA";
              return stage("VALIDATE CLOUD MEDIA", async () => undefined).then(() => undefined);
            },
            playbackTested: () => {
              activeStage = "TEST PLAYBACK";
              return stage("TEST PLAYBACK", async () => undefined).then(() => undefined);
            },
            registered: () => {
              activeStage = "REGISTER DATABASE";
              return stage("REGISTER DATABASE", async () => undefined).then(() => undefined);
            },
            published: () => {
              activeStage = "ATOMIC PUBLISH";
              return stage("ATOMIC PUBLISH", async () => undefined).then(() => undefined);
            },
          },
        );
      } else {
        for (const publishStage of [
          "UPLOAD NEW MEDIA VERSION",
          "VALIDATE CLOUD MEDIA",
          "TEST PLAYBACK",
          "REGISTER DATABASE",
          "ATOMIC PUBLISH",
        ] as const)
          await stage(publishStage, async () => undefined);
      }
      await stage("READY", async () => {
        await state("READY");
      });
    } catch (error) {
      failedStage = activeStage;
      await state("FAILED").catch(() => undefined);
      if (context.version && this.dependencies.publisher)
        await this.dependencies.publisher.failReserved(context.version.id).catch(() => undefined);
      const report: IngestReport = {
        input: options.input,
        contentId: options.contentId,
        episodeId: options.episodeId,
        outputDirectory,
        dryRun: options.dryRun,
        skippedAi: options.skipAi,
        completedStages,
        failedStage,
        mediaVersionId: context.version?.id ?? null,
        reportPath,
        logPath,
        totalMs: this.now() - started,
      };
      await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
      throw error;
    }
    const report: IngestReport = {
      input: options.input,
      contentId: options.contentId,
      episodeId: options.episodeId,
      outputDirectory,
      dryRun: options.dryRun,
      skippedAi: options.skipAi,
      completedStages,
      failedStage,
      mediaVersionId: context.version?.id ?? null,
      reportPath,
      logPath,
      totalMs: this.now() - started,
    };
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    return report;
  }
}

export { IngestOptionsSchema };
