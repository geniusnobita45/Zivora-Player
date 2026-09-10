// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { join } from "node:path";
import { rm } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  renderAuthCatalogMediaMigration,
  renderPublicationMigration,
  renderSubtitleMigration,
} from "@/database/migrations/build";
import {
  Publisher,
  type MediaRegistration,
  type PublicationRepository,
} from "@/pipeline/publish/Publisher";
import { VersionManager, type VersionTarget } from "@/pipeline/publish/VersionManager";
import { R2Uploader } from "@/pipeline/publish/R2Uploader";
import {
  MemoryStore,
  publicationFixture,
  contentId,
  episodeId,
  versionId,
} from "./publicationFixture";

describe("publication SQL executed in PostgreSQL", () => {
  const db = new PGlite();
  let directory: string;
  beforeAll(async () => {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key);
      grant usage on schema public to anon, authenticated, service_role;`);
    await db.exec(await renderAuthCatalogMediaMigration(join(process.cwd(), "database")));
    await db.exec(await renderPublicationMigration(join(process.cwd(), "database")));
    await db.exec(await renderSubtitleMigration(join(process.cwd(), "database")));
    await db.query(
      "insert into public.content(id,type,title,state) values($1,'series','SQL test','READY')",
      [contentId],
    );
    await db.query("insert into public.shows(id,content_id) values($1,$2)", [versionId, contentId]);
    await db.query("insert into public.seasons(id,show_id,season_number) values($1,$2,1)", [
      versionId,
      versionId,
    ]);
    await db.query(
      "insert into public.episodes(id,season_id,title,order_index) values($1,$2,'Episode',1)",
      [episodeId, versionId],
    );
    directory = (await publicationFixture()).root;
    await db.exec("set role service_role");
  }, 30_000);
  afterAll(async () => {
    await db.close();
    if (directory) await rm(directory, { recursive: true, force: true });
  });
  const rpc = async (name: string, args: unknown[]) => {
    const allowed = new Set([
      "reserve_media_version",
      "register_media_version",
      "ready_media_version",
      "publish_media_version",
      "fail_media_version",
      "rollback_media_version",
    ]);
    if (!allowed.has(name)) throw new Error("Invalid test RPC");
    const result = await db.query<{ result: unknown }>(
      `select public.${name}(${args.map((_, i) => `$${i + 1}`).join(",")}) as result`,
      args,
    );
    return result.rows[0].result;
  };
  const repository: PublicationRepository & {
    reserve: (target: VersionTarget) => Promise<unknown>;
  } = {
    reserve: (target) => rpc("reserve_media_version", [target.contentId, target.episodeId]),
    register: async (id: string, media: MediaRegistration) => {
      await rpc("register_media_version", [id, JSON.stringify(media)]);
    },
    markReady: async (id) => {
      await rpc("ready_media_version", [id]);
    },
    publish: async (id) => String(await rpc("publish_media_version", [id])),
    fail: async (id) => {
      await rpc("fail_media_version", [id]);
    },
    rollback: async (id) => String(await rpc("rollback_media_version", [id])),
  };
  const publisher = () =>
    new Publisher(
      new VersionManager(repository),
      repository,
      () => new R2Uploader(new MemoryStore()),
    );

  it("publishes twice, records history, rolls back and prevents mutation of live versions", async () => {
    const p = publisher();
    const one = await p.publish({ directory, contentId, episodeId });
    const two = await p.publish({ directory, contentId, episodeId });
    expect(two.versionNumber).toBe(one.versionNumber + 1);
    const active = await db.query<{ active_media_version_id: string }>(
      "select active_media_version_id from public.episodes where id=$1",
      [episodeId],
    );
    expect(active.rows[0].active_media_version_id).toBe(two.id);
    const subtitles = await db.query(
      "select kind, has_speaker_names, has_context_hints from public.subtitle_tracks where media_version_id=$1",
      [two.id],
    );
    expect(subtitles.rows).toEqual([
      { kind: "original", has_speaker_names: false, has_context_hints: false },
    ]);
    expect(await repository.publish(two.id)).toBe(two.id);
    await repository.fail(two.id); // A lost success response cannot fail a live version.
    const history = await db.query<{ previous_media_version_id: string; state: string }>(
      "select previous_media_version_id,state from public.media_versions where id=$1",
      [two.id],
    );
    expect(history.rows[0]).toEqual({ previous_media_version_id: one.id, state: "READY" });
    expect(await p.rollback(episodeId)).toBe(one.id);
    await expect(repository.publish(two.id)).rejects.toThrow("rollback");
    await expect(
      db.query("update public.media_versions set checksums='{}' where id=$1", [one.id]),
    ).rejects.toThrow("immutable");
    await expect(
      db.query("delete from public.manifests where media_version_id=$1", [one.id]),
    ).rejects.toThrow("immutable");
    await expect(
      db.query("update public.content set access_level='public' where id=$1", [contentId]),
    ).rejects.toThrow("storage reservation");
  }, 20_000);
  it("reserves unique monotonic versions and rejects incomplete/cross-parent publication", async () => {
    const versions = await Promise.all(
      [1, 2, 3].map(() => new VersionManager(repository).allocate({ contentId, episodeId })),
    );
    expect(new Set(versions.map((v) => v.versionNumber)).size).toBe(3);
    await expect(repository.publish(versions[0].id)).rejects.toThrow("READY");
    await expect(repository.markReady(versions[0].id)).rejects.toThrow("validated");
    await expect(rpc("register_media_version", [versions[0].id, "{}"])).rejects.toThrow(
      "Checksums",
    );
    await expect(
      new VersionManager(repository).allocate({ contentId, episodeId: versionId }),
    ).rejects.toThrow("belong");
  });
  it("stores subtitle variants and flags while rejecting unsupported kinds", async () => {
    const reserved = await new VersionManager(repository).allocate({ contentId, episodeId });
    await db.query(
      "insert into public.subtitle_tracks(media_version_id,language,label,playlist_path,checksum_sha256,kind,has_speaker_names,has_context_hints) values($1,'fr','French natural','subtitles/fr-natural/index.m3u8',$2,'natural',true,true)",
      [reserved.id, "a".repeat(64)],
    );
    expect(
      (
        await db.query(
          "select kind,has_speaker_names,has_context_hints from public.subtitle_tracks where media_version_id=$1",
          [reserved.id],
        )
      ).rows,
    ).toEqual([{ kind: "natural", has_speaker_names: true, has_context_hints: true }]);
    await expect(
      db.query(
        "insert into public.subtitle_tracks(media_version_id,language,label,playlist_path,checksum_sha256,kind) values($1,'fr','Unsupported','subtitles/invalid/index.m3u8',$2,'invented')",
        [reserved.id, "a".repeat(64)],
      ),
    ).rejects.toThrow("subtitle_tracks_kind_valid");
  });
  it("restricts base tables and all mutation RPCs while leaving the READY catalog readable", async () => {
    await db.exec("reset role; set role anon");
    try {
      await expect(db.query("select * from public.content")).rejects.toThrow("permission denied");
      await expect(rpc("reserve_media_version", [contentId, episodeId])).rejects.toThrow(
        "permission denied",
      );
      await expect(rpc("publish_media_version", [versionId])).rejects.toThrow("permission denied");
      await expect(db.query("select * from public.public_catalog")).resolves.toBeDefined();
    } finally {
      await db.exec("reset role; set role service_role");
    }
  });
});
