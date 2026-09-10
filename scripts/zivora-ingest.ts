import { fileURLToPath } from "node:url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/lib/supabase/types";
import { createR2Storage } from "@/lib/r2/client";
import { IngestPipeline, IngestOptionsSchema, type IngestStateStore } from "@/pipeline/ingest";
import { SupabasePublicationRepository } from "@/pipeline/publish/SupabasePublicationRepository";
import { Publisher } from "@/pipeline/publish/Publisher";
import { R2Uploader } from "@/pipeline/publish/R2Uploader";
import { VersionManager } from "@/pipeline/publish/VersionManager";
import type { AIProvider } from "@/features/ai/gateway/AIProvider";
import { createAIGateway, SupabaseAIUsageRepository } from "@/features/ai/gateway";
import {
  SupabaseIntelligenceRepository,
  type SupabaseWriteClient,
} from "@/pipeline/intelligence/IntelligenceRepository";

const EnvironmentSchema = z
  .object({
    NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  })
  .passthrough();

class UnconfiguredAIProvider implements AIProvider {
  readonly name = "unconfigured";
  readonly model = "unconfigured";
  readonly embeddingModel = "unconfigured";
  private unavailable(): never {
    throw new Error("Configure an AIProvider in the ingest worker or pass --skip-ai");
  }
  generate<T>(): Promise<T> {
    return Promise.reject(this.unavailable());
  }
  embed(): Promise<unknown> {
    return Promise.reject(this.unavailable());
  }
  transcribe(): Promise<unknown> {
    return Promise.reject(this.unavailable());
  }
  vision<T>(): Promise<T> {
    return Promise.reject(this.unavailable());
  }
}

class SupabaseIngestState implements IngestStateStore {
  constructor(private readonly client: SupabaseClient<Database>) {}
  async setContentState(
    contentId: string,
    state: "UPLOADED" | "PROCESSING" | "AI_PROCESSING" | "VALIDATING" | "READY" | "FAILED",
  ): Promise<void> {
    const { error } = await this.client.from("content").update({ state }).eq("id", contentId);
    if (error) throw new Error(`Unable to update content state to ${state}`, { cause: error });
  }
}

export function parseIngestArguments(args: readonly string[]) {
  const values: Record<string, unknown> = { subtitles: [] };
  const positional: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (!flag.startsWith("--")) {
      positional.push(flag);
      continue;
    }
    if (flag === "--skip-ai") {
      values.skipAi = true;
      continue;
    }
    if (flag === "--dry-run") {
      values.dryRun = true;
      continue;
    }
    if (flag === "--rollback") {
      values.rollback = true;
      continue;
    }
    if (
      ![
        "--content",
        "--episode",
        "--from",
        "--output",
        "--log",
        "--checkpoint",
        "--subtitle-enrichment",
        "--subtitle",
      ].includes(flag)
    )
      throw new Error(`Unknown option: ${flag}`);
    const value = args[++index];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${flag}`);
    if (flag === "--content") values.contentId = value;
    else if (flag === "--episode") values.episodeId = value;
    else if (flag === "--from") values.from = value;
    else if (flag === "--output") values.output = value;
    else if (flag === "--log") values.logPath = value;
    else if (flag === "--checkpoint") values.checkpointPath = value;
    else if (flag === "--subtitle-enrichment") values.subtitleEnrichment = value;
    else if (flag === "--subtitle") {
      const separator = value.indexOf("=");
      if (separator <= 0) throw new Error("--subtitle must be LANGUAGE=PATH");
      (values.subtitles as { language: string; path: string }[]).push({
        language: value.slice(0, separator),
        path: value.slice(separator + 1),
      });
    } else throw new Error(`Unknown option: ${flag}`);
  }
  if (positional.length > 1) throw new Error("Only one input media file is allowed");
  if (positional[0]) values.input = positional[0];
  if (!values.contentId) throw new Error("--content identifies the content or episode");
  if (values.rollback)
    return { ...IngestOptionsSchema.omit({ input: true }).parse(values), input: "" };
  return IngestOptionsSchema.parse(values);
}

export async function runIngest(args: readonly string[]) {
  const options = parseIngestArguments(args);
  if (options.dryRun && options.skipAi) return new IngestPipeline().run(options);
  const environment = EnvironmentSchema.parse(process.env);
  const client = createClient<Database>(
    environment.NEXT_PUBLIC_SUPABASE_URL,
    environment.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
  );
  const repository = new SupabasePublicationRepository(client);
  if (options.rollback) {
    const mediaVersionId = await repository.rollback(options.contentId);
    return { rollback: true, mediaVersionId };
  }
  const storage = createR2Storage();
  const publisher = new Publisher(
    new VersionManager(repository),
    repository,
    (version) => new R2Uploader(storage.forAccess(version.access)),
  );
  const provider = process.env.OPENAI_API_KEY
    ? createAIGateway(
        process.env,
        new SupabaseAIUsageRepository((value) => client.from("ai_usage").insert(value)),
      )
    : new UnconfiguredAIProvider();
  const pipeline = new IngestPipeline({
    state: new SupabaseIngestState(client),
    versionManager: new VersionManager(repository),
    publisher,
    provider,
    intelligenceRepository: new SupabaseIntelligenceRepository(
      client as unknown as SupabaseWriteClient,
    ),
  });
  return pipeline.run(options);
}

async function main(): Promise<void> {
  const result = await runIngest(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  void main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
