// @vitest-environment node
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderIntelligenceMigration } from "@/database/migrations/build";

describe("INTELLIGENCE migration", () => {
  it("is generated from ordered layers with the frozen tables and indexes", async () => {
    const root = join(process.cwd(), "database");
    const sql = await renderIntelligenceMigration(root);
    expect(await readFile(join(root, "migrations", "006_intelligence.sql"), "utf8")).toBe(sql);
    expect(sql.match(/create table public\./g)).toHaveLength(10);
    for (const table of [
      "transcripts",
      "transcript_segments",
      "scenes",
      "scene_embeddings",
      "characters",
      "character_appearances",
      "chapters",
      "skip_segments",
      "recap_segments",
      "entities",
    ])
      expect(sql).toContain(`public.${table}`);
    expect(sql).toContain("search_vector tsvector generated always");
    expect(sql.match(/using gin\(search_vector\)/g)).toHaveLength(2);
    expect(sql.match(/using hnsw/g)).toHaveLength(2);
    expect(sql).toContain("extensions.vector(1536)");
    expect(sql).toContain("extensions.vector_cosine_ops");
    expect(sql).toContain("revoke all on table public.%I from public, anon, authenticated");
    expect(sql).not.toMatch(/create policy/i);
  });
});
