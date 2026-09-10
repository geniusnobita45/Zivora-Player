// @vitest-environment node
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  renderPlaybackMigration,
  renderObservabilityMigration,
  MIGRATION_PARTS,
  renderAuthCatalogMediaMigration,
  renderPublicationMigration,
  renderSubtitleMigration,
} from "@/database/migrations/build";
import { Constants, type TablesInsert } from "@/lib/supabase/types";

const databaseRoot = fileURLToPath(new URL("../../database/", import.meta.url));
const migrationPath = join(databaseRoot, "migrations", "001_auth_catalog_media.sql");

const tables = [
  "profiles",
  "preferences",
  "content",
  "shows",
  "seasons",
  "episodes",
  "genres",
  "content_genres",
  "media_versions",
  "manifests",
  "renditions",
  "audio_tracks",
  "subtitle_tracks",
  "thumbnails",
] as const;

describe("AUTH, CATALOG, and MEDIA migration", () => {
  it("generates service-only OBSERVABILITY tables and metrics views from source layers", async () => {
    const sql = await renderObservabilityMigration(databaseRoot);
    expect(await readFile(join(databaseRoot, "migrations", "005_observability.sql"), "utf8")).toBe(
      sql,
    );
    expect(sql.match(/create table public\./g)).toHaveLength(5);
    expect(sql.match(/create view public\.analytics_/g)).toHaveLength(5);
    expect(sql).toContain("security_invoker = true");
    expect(sql).not.toMatch(/security definer/i);
    expect(sql).toContain(
      "revoke all on table public.playback_events from public, anon, authenticated",
    );
    expect(sql).toContain("grant select on table public.analytics_video_startup_time");
  });
  it("generates the PLAYBACK domain from its four source layers", async () => {
    const sql = await renderPlaybackMigration(databaseRoot);
    expect(await readFile(join(databaseRoot, "migrations", "004_playback.sql"), "utf8")).toBe(sql);
    expect(sql.match(/create table public\./g)).toHaveLength(5);
    expect(sql).not.toMatch(/security definer/i);
    expect(sql).toContain(
      "greatest(watch_progress.furthest_position_s, excluded.furthest_position_s)",
    );
    expect(sql).toContain("with check ((select auth.uid()) = user_id)");
  });
  it("keeps subtitle metadata additive and its generated migration current", async () => {
    const sql = await renderSubtitleMigration(databaseRoot);
    expect(
      await readFile(join(databaseRoot, "migrations", "003_subtitle_variants.sql"), "utf8"),
    ).toBe(sql);
    expect(sql).not.toMatch(/create table|security definer/i);
    expect(sql).toContain("kind in ('original', 'literal', 'natural')");
    expect(sql).toContain("has_speaker_names");
    expect(sql).toContain("has_context_hints");
  });
  it("keeps the additive publication migration identical to its source layers", async () => {
    expect(await readFile(join(databaseRoot, "migrations", "002_publication.sql"), "utf8")).toBe(
      await renderPublicationMigration(databaseRoot),
    );
  });
  it("keeps the generated migration identical to its ordered source layers", async () => {
    const generated = await readFile(migrationPath, "utf8");
    expect(generated).toBe(await renderAuthCatalogMediaMigration(databaseRoot));

    let previousIndex = -1;
    for (const part of MIGRATION_PARTS) {
      const index = generated.indexOf(`-- BEGIN ${part}`);
      expect(index).toBeGreaterThan(previousIndex);
      previousIndex = index;
    }
    expect(generated.trimStart()).toContain("begin;");
    expect(generated.trimEnd().endsWith("commit;")).toBe(true);
  });

  it("creates exactly the requested domain tables", async () => {
    const sql = await readFile(migrationPath, "utf8");
    const createdTables = [...sql.matchAll(/create table public\.([a-z_]+)/g)].map(
      (match) => match[1],
    );

    expect(createdTables).toEqual(tables);
    expect(sql).not.toMatch(/create table (?!public\.)/);
  });

  it("enforces content states, media ownership, and immutable version metadata", async () => {
    const sql = await readFile(migrationPath, "utf8");

    expect(sql).toContain("'UPLOADED'");
    expect(sql).toContain("'PROCESSING'");
    expect(sql).toContain("'AI_PROCESSING'");
    expect(sql).toContain("'VALIDATING'");
    expect(sql).toContain("'READY'");
    expect(sql).toContain("'FAILED'");
    expect(sql).toContain("num_nonnulls(content_id, episode_id) = 1");
    expect(sql).toContain("constraint media_versions_r2_prefix_unique unique (r2_prefix)");
    expect(sql).toContain("previous_media_version_id uuid references public.media_versions");
    expect(sql).toContain("foreign key (id, active_media_version_id)");
    expect(sql).toContain("keyframe_interval_seconds = 2");
    expect(sql).toContain("segment_duration_seconds = 4");
  });

  it("enables RLS on every table and grants no direct public table reads", async () => {
    const sql = await readFile(migrationPath, "utf8");

    for (const table of tables) {
      expect(sql).toContain(`alter table public.${table} enable row level security;`);
      expect(sql).toContain(
        `revoke all on table public.${table} from public, anon, authenticated;`,
      );
      expect(sql).toContain(
        `grant select, insert, update, delete on table public.${table} to service_role;`,
      );
    }
    expect(sql).not.toMatch(
      /grant select on table public\.(?:content|media_versions) to (?:anon|authenticated)/,
    );
  });

  it("publishes and rolls back through service-only, row-locking functions", async () => {
    const sql = await readFile(migrationPath, "utf8");

    expect(sql).toContain("function public.publish_media_version(version_id uuid)");
    expect(sql).toContain("function public.rollback_media_version(content_or_episode_id uuid)");
    expect(sql.match(/for update;/g)).toHaveLength(7);
    expect(sql).toContain("if target_version.state <> 'READY'");
    expect(sql).toContain("set previous_media_version_id = prior_version_id");
    expect(sql).toContain("set active_media_version_id = prior_version.id");
    expect(sql.match(/security invoker/g)).toHaveLength(2);
    expect(sql).not.toContain("security definer");
    expect(sql).toContain(
      "grant execute on function public.publish_media_version(uuid) to service_role;",
    );
    expect(sql).toContain(
      "grant execute on function public.rollback_media_version(uuid) to service_role;",
    );
  });

  it("exposes only the filtered public catalog view", async () => {
    const sql = await readFile(migrationPath, "utf8");
    const view = sql.slice(sql.indexOf("create view public.public_catalog"));

    expect(view).toContain("security_barrier = true");
    expect(view).toContain("security_invoker = false");
    expect(view).toContain("where c.state = 'READY'");
    expect(view).toContain("c.active_media_version_id is not null");
    expect(view).toContain("mv.state = 'READY'");
    expect(view).not.toContain("c.metadata");
    expect(view).not.toContain("mv.checksums");
    expect(view).toContain(
      "grant select on table public.public_catalog to anon, authenticated, service_role;",
    );
  });

  it("keeps generated TypeScript enums and inserts aligned with SQL", () => {
    const insert: TablesInsert<"content"> = {
      title: "A Zivora title",
      type: "long_video",
    };

    expect(insert).toEqual({ title: "A Zivora title", type: "long_video" });
    expect(Constants.public.Enums.content_state).toEqual([
      "UPLOADED",
      "PROCESSING",
      "AI_PROCESSING",
      "VALIDATING",
      "READY",
      "FAILED",
    ]);
  });
});
