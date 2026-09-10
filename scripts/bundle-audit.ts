import { readFile, readdir, stat } from "node:fs/promises";
import { resolve, join } from "node:path";
import { z } from "zod";

const ManifestSchema = z
  .object({ pages: z.record(z.array(z.string())), rootMainFiles: z.array(z.string()).optional() })
  .passthrough();
async function main(): Promise<void> {
  const root = resolve(process.cwd(), ".next");
  const manifest = ManifestSchema.parse(
    JSON.parse(await readFile(join(root, "build-manifest.json"), "utf8")),
  );
  const initial = new Set([
    ...(manifest.rootMainFiles ?? []),
    ...Object.values(manifest.pages).flat(),
  ]);
  let total = 0;
  for (const relative of initial) {
    const file = join(root, relative);
    const info = await stat(file);
    total += info.size;
    const source = await readFile(file, "utf8");
    if (/shaka-player|zivora_grounded_answer|zivora-precision-timeline/.test(source))
      throw new Error(`Heavy optional module leaked into an initial chunk: ${relative}`);
  }
  const chunks = await readdir(join(root, "static", "chunks"));
  const largest = (
    await Promise.all(
      chunks
        .filter((file) => file.endsWith(".js"))
        .map(async (file) => ({
          file,
          bytes: (await stat(join(root, "static", "chunks", file))).size,
        })),
    )
  ).sort((a, b) => b.bytes - a.bytes)[0];
  if (total > 1_500_000) throw new Error(`Initial JavaScript exceeds 1.5 MB: ${total} bytes`);
  if (largest && largest.bytes > 1_000_000) throw new Error(`Chunk ${largest.file} exceeds 1 MB`);
  process.stdout.write(
    JSON.stringify({ initialBytes: total, largestChunk: largest ?? null }, null, 2) + "\n",
  );
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
