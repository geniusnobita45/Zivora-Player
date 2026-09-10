// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import {
  renderAuthCatalogMediaMigration,
  renderPublicationMigration,
  renderPlaybackMigration,
  renderIntelligenceMigration,
  renderAiMigration,
  renderAiRetrievalMigration,
} from "@/database/migrations/build";
import { uid } from "../ai/fixtures";
import type { AISearchRow } from "@/lib/supabase/types";

describe("SQL spoiler boundary, hybrid fusion and access control", () => {
  const db = new PGlite({ extensions: { vector } });
  const content = uid(1),
    movie = uid(2),
    owner = uid(3),
    other = uid(4);
  const embedding = JSON.stringify(Array.from({ length: 1536 }, (_, i) => (i === 0 ? 1 : 0)));
  async function addVersion(id: string, parent: string, episode: boolean, active = true) {
    await db.query(
      "insert into public.media_versions(id,content_id,episode_id,version_number,r2_prefix,state,checksums) values($1,$2,$3,$4,$5,'READY','{}')",
      [id, episode ? null : parent, episode ? parent : null, active ? 1 : 2, "media/" + id + "/"],
    );
    if (active)
      await db.query(
        episode
          ? "update public.episodes set active_media_version_id=$1 where id=$2"
          : "update public.content set active_media_version_id=$1 where id=$2",
        [id, parent],
      );
    await db.query(
      "insert into public.transcripts(id,media_version_id,language,duration_s,provider,model,source_checksum) values($1,$1,'en',100,'mock','fixture',$2)",
      [id, "a".repeat(64)],
    );
  }
  async function addScene(
    n: number,
    version: string,
    start: number,
    end: number,
    title = "lighthouse",
  ) {
    const id = uid(n);
    await db.query(
      "insert into public.scenes(id,media_version_id,scene_index,start_s,end_s,title,summary) values($1,$2,$3,$4,$5,$6,'lighthouse evidence')",
      [id, version, n, start, end, title],
    );
    await db.query(
      "insert into public.scene_embeddings(id,scene_id,media_version_id,embedding,embedding_model) values($1,$1,$2,$3::extensions.vector,'fixture')",
      [id, version, embedding],
    );
    await db.query(
      "insert into public.transcript_segments(id,transcript_id,media_version_id,sequence_index,start_s,end_s,text,embedding,embedding_model) values($1,$2,$2,$3,$4,$5,'lighthouse words',$6::extensions.vector,'fixture')",
      [uid(n + 1000), version, n, start, end, embedding],
    );
  }
  const search = async (
    fn: "search_scenes" | "search_transcript",
    order: number,
    seconds: number,
    options: { content?: string; vector?: string | null; filters?: object } = {},
  ) =>
    (
      await db.query<AISearchRow>(
        `select * from public.${fn}($1::extensions.vector,$2,$3,$4,$5,$6::jsonb,30)`,
        [
          options.vector === undefined ? embedding : options.vector,
          "lighthouse",
          options.content ?? content,
          order,
          seconds,
          JSON.stringify(options.filters ?? {}),
        ],
      )
    ).rows;
  beforeAll(async () => {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema public,auth to anon,authenticated,service_role;`);
    const root = join(process.cwd(), "database");
    for (const render of [
      renderAuthCatalogMediaMigration,
      renderPublicationMigration,
      renderPlaybackMigration,
      renderIntelligenceMigration,
      renderAiMigration,
      renderAiRetrievalMigration,
    ])
      await db.exec(await render(root));
    await db.query("insert into auth.users values($1),($2)", [owner, other]);
    await db.query(
      "insert into public.content(id,type,title,state) values($1,'series','Show','READY'),($2,'movie','Movie','READY')",
      [content, movie],
    );
    await db.query("insert into public.shows(id,content_id) values($1,$2)", [uid(5), content]);
    await db.query(
      "insert into public.seasons(id,show_id,season_number) values($1,$3,1),($2,$3,2)",
      [uid(6), uid(7), uid(5)],
    );
    // Repeated local order_index across seasons must not turn season two into an earlier episode.
    await db.query(
      "insert into public.episodes(id,season_id,title,order_index,runtime_seconds) values($1,$4,'First',1,100),($2,$4,'Second',2,100),($3,$5,'Third',1,100)",
      [uid(10), uid(11), uid(12), uid(6), uid(7)],
    );
    await addVersion(uid(20), uid(10), true);
    await addVersion(uid(21), uid(11), true);
    await addVersion(uid(22), uid(12), true);
    await addVersion(uid(23), movie, false);
    await addVersion(uid(24), uid(11), true, false);
    await addScene(100, uid(20), 0, 90);
    await addScene(101, uid(21), 0, 10);
    await addScene(102, uid(21), 10, 20);
    await addScene(103, uid(21), 19, 20.001);
    await addScene(104, uid(21), 20, 30);
    await addScene(105, uid(22), 0, 1);
    await addScene(106, uid(23), 0, 20);
    await addScene(107, uid(24), 0, 10);
    await db.query(
      "insert into public.chapters(id,media_version_id,chapter_index,start_s,end_s,title,summary) values($1,$2,0,0,30,'Future chapter secret','secret')",
      [uid(30), uid(21)],
    );
    await db.exec("set role service_role");
  }, 60000);
  afterAll(async () => {
    await db.close();
  });
  it("generated migration matches its ordered source layers", async () => {
    expect(
      await readFile(join(process.cwd(), "database/migrations/008_ai_retrieval.sql"), "utf8"),
    ).toBe(await renderAiRetrievalMigration(join(process.cwd(), "database")));
  });
  it.each(["search_scenes", "search_transcript"] as const)(
    "%s excludes crossing intervals, later episodes, stale versions and other content",
    async (fn) => {
      const rows = await search(fn, 1, 20);
      expect(rows.map((row) => row.id).sort()).toEqual(
        (fn === "search_scenes"
          ? [uid(100), uid(101), uid(102)]
          : [uid(1100), uid(1101), uid(1102)]
        ).sort(),
      );
      expect(rows.every((row) => row.episode_order < 1 || row.end_s <= 20)).toBe(true);
      expect(rows.every((row) => row.chapter_title === null)).toBe(true);
      expect(rows.some((row) => row.end_s === 20)).toBe(true);
      expect(
        rows.every(
          (row) => row.fused_score > 0 && row.vector_score !== null && row.keyword_score > 0,
        ),
      ).toBe(true);
      expect(await search(fn, 0, 0)).toEqual([]);
    },
  );
  it("preserves exact-boundary movie behavior and filters inside both rank branches", async () => {
    expect(await search("search_scenes", 0, 19.999, { content: movie })).toEqual([]);
    expect((await search("search_scenes", 0, 20, { content: movie })).map((row) => row.id)).toEqual(
      [uid(106)],
    );
    expect(
      (await search("search_scenes", 1, 20, { filters: { episode_id: uid(11) } })).every(
        (row) => row.episode_id === uid(11),
      ),
    ).toBe(true);
    expect(await search("search_scenes", 1, 20, { filters: { language: "fr" } })).toEqual([]);
    expect(
      await search("search_scenes", 1, 20, { filters: { media_version_ids: [uid(24)] } }),
    ).toEqual([]);
  });
  it("works with keywords alone and rejects invalid boundaries and dimensions", async () => {
    const lexical = await search("search_scenes", 1, 20, { vector: null });
    expect(lexical).toHaveLength(3);
    expect(lexical.every((row) => row.vector_score === null)).toBe(true);
    await expect(search("search_scenes", 1, NaN)).rejects.toThrow();
    await expect(search("search_transcript", -1, 20)).rejects.toThrow();
    await expect(search("search_scenes", 1, 20, { vector: "[1,2,3]" })).rejects.toThrow();
  });
  it("never exposes non-READY content even with an active pointer", async () => {
    await db.query("update public.content set state='PROCESSING' where id=$1", [movie]);
    expect(await search("search_scenes", 0, 100, { content: movie })).toEqual([]);
    await db.query("update public.content set state='READY' where id=$1", [movie]);
  });
  it("denies direct retrieval to authenticated and anonymous callers", async () => {
    for (const role of ["anon", "authenticated"]) {
      await db.exec("reset role; set role " + role);
      await expect(search("search_scenes", 1, 20)).rejects.toThrow(/permission/i);
      await expect(search("search_transcript", 1, 20)).rejects.toThrow(/permission/i);
    }
    await db.exec("reset role; set role service_role");
  });
  it("atomically persists exchanges and prevents cross-user conversation writes", async () => {
    const response = JSON.stringify({ answer: "Safe response", confidence: 0.9, candidates: [] });
    const query = "select public.append_ai_exchange($1,$2,null,$3,'Question',$4::jsonb) as id";
    const result = await db.query<{ id: string }>(query, [owner, movie, null, response]);
    const conversation = result.rows[0].id;
    await expect(db.query(query, [other, movie, conversation, response])).rejects.toThrow(
      /Conversation unavailable/,
    );
    expect(
      (await db.query("select * from public.ai_messages where conversation_id=$1", [conversation]))
        .rows,
    ).toHaveLength(2);
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [other]);
    await db.exec("set role authenticated");
    expect((await db.query("select * from public.ai_messages")).rows).toEqual([]);
    await db.exec("reset role; set role service_role");
  });
  it("reserves a shared per-user rate window without exceeding the limit", async () => {
    const result = await Promise.all(
      Array.from({ length: 22 }, () =>
        db.query<{ allowed: boolean }>("select public.consume_ai_request($1) as allowed", [owner]),
      ),
    );
    expect(result.filter((value) => value.rows[0].allowed)).toHaveLength(20);
    expect(
      (
        await db.query<{ allowed: boolean }>("select public.consume_ai_request($1) as allowed", [
          other,
        ])
      ).rows[0].allowed,
    ).toBe(true);
  });
});
