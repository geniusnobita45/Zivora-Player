import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/lib/supabase/types";
import { createR2Storage } from "@/lib/r2/client";
import { Publisher } from "./Publisher";
import { R2Uploader } from "./R2Uploader";
import { VersionManager } from "./VersionManager";
import { SupabasePublicationRepository } from "./SupabasePublicationRepository";

export function parsePublishArguments(args: string[]) {
  const [command, ...rest] = args;
  if (command !== "publish" && command !== "rollback")
    throw new Error(
      "Usage: publish-video.sh publish --directory <package> --content-id <uuid> [--episode-id <uuid>] | rollback --id <content-or-episode-uuid>",
    );
  const flags: Record<string, string> = {};
  for (let i = 0; i < rest.length; i += 2) {
    if (!rest[i].startsWith("--") || !rest[i + 1] || flags[rest[i]])
      throw new Error("Invalid or duplicate command option");
    flags[rest[i]] = rest[i + 1];
  }
  if (command === "rollback")
    return {
      command: "rollback" as const,
      ...z.object({ "--id": z.string().uuid() }).strict().parse(flags),
    };
  return {
    command: "publish" as const,
    ...z
      .object({
        "--directory": z.string().min(1),
        "--content-id": z.string().uuid(),
        "--episode-id": z.string().uuid().optional(),
      })
      .strict()
      .parse(flags),
  };
}

async function main(): Promise<void> {
  const args = parsePublishArguments(process.argv.slice(2));
  const environment = z
    .object({
      NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
      SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
    })
    .parse(process.env);
  const client = createClient<Database>(
    environment.NEXT_PUBLIC_SUPABASE_URL,
    environment.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
  );
  const repository = new SupabasePublicationRepository(client);
  if (args.command === "rollback") {
    process.stdout.write(
      `${JSON.stringify({ mediaVersionId: await repository.rollback(args["--id"]) })}\n`,
    );
    return;
  }
  const storage = createR2Storage();
  const publisher = new Publisher(
    new VersionManager(repository),
    repository,
    (version) => new R2Uploader(storage.forAccess(version.access)),
  );
  const result = await publisher.publish({
    directory: resolve(args["--directory"]),
    contentId: args["--content-id"],
    episodeId: args["--episode-id"] ?? null,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Publication failed"}\n`);
    process.exitCode = 1;
  });
}
