// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  renderAuthCatalogMediaMigration,
  renderPublicationMigration,
  renderSubtitleMigration,
  renderPlaybackMigration,
} from "@/database/migrations/build";
const a = "11111111-1111-4111-8111-111111111111",
  b = "22222222-2222-4222-8222-222222222222",
  content = "33333333-3333-4333-8333-333333333333",
  session = "44444444-4444-4444-8444-444444444444",
  bookmark = "55555555-5555-4555-8555-555555555555";
describe("PLAYBACK SQL and RLS", () => {
  const db = new PGlite();
  const identity = async (id: string) => {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
    await db.exec("set role authenticated");
  };
  const upsert = async (
    position: number,
    furthest: number,
    seconds: number,
    sessionId: string | null = session,
  ) =>
    db.query<{ position_s: number; furthest_position_s: number }>(
      "select * from public.upsert_progress($1,null,$2,$3,100,$4,$5)",
      [
        content,
        position,
        furthest,
        `2026-01-01T00:00:${String(seconds).padStart(2, "0")}Z`,
        sessionId,
      ],
    );
  beforeAll(async () => {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema public,auth to anon,authenticated,service_role;`);
    const root = join(process.cwd(), "database");
    for (const render of [
      renderAuthCatalogMediaMigration,
      renderPublicationMigration,
      renderSubtitleMigration,
      renderPlaybackMigration,
    ])
      await db.exec(await render(root));
    await db.query("insert into auth.users(id) values($1),($2)", [a, b]);
    await db.query(
      "insert into public.content(id,type,title,state) values($1,'movie','Progress fixture','READY')",
      [content],
    );
    await identity(a);
  }, 30000);
  afterAll(async () => {
    await db.close();
  });
  it("atomically records progress/history/session, honors rewinds and never decreases furthest", async () => {
    await upsert(90, 90, 1);
    expect((await upsert(20, 20, 2)).rows[0]).toMatchObject({
      position_s: 20,
      furthest_position_s: 90,
    });
    expect((await upsert(99, 99, 1)).rows[0]).toMatchObject({
      position_s: 20,
      furthest_position_s: 99,
    });
    expect((await db.query("select position_s from public.watch_history")).rows).toEqual([
      { position_s: 20 },
    ]);
    expect((await db.query("select position_s from public.playback_sessions")).rows).toEqual([
      { position_s: 20 },
    ]);
    await db.query(
      "update public.watch_progress set position_s=10,furthest_position_s=10,updated_at='2026-01-01T00:00:03Z'",
    );
    expect((await db.query("select furthest_position_s from public.watch_progress")).rows).toEqual([
      { furthest_position_s: 99 },
    ]);
    await expect(db.exec("delete from public.watch_progress")).rejects.toThrow(/permission/i);
  });
  it("enforces row ownership for all five tables and refuses owner reassignment", async () => {
    await db.query(
      "insert into public.bookmarks(id,user_id,content_id,position_s,title,updated_at) values($1,$2,$3,5,'Marker',now())",
      [bookmark, a, content],
    );
    await db.query("insert into public.playback_preferences(user_id) values($1)", [a]);
    const tables = [
      "watch_progress",
      "watch_history",
      "bookmarks",
      "playback_sessions",
      "playback_preferences",
    ];
    for (const table of tables)
      await expect(db.query(`update public.${table} set user_id=$1`, [b])).rejects.toThrow();
    await identity(b);
    for (const table of tables)
      expect((await db.query(`select * from public.${table}`)).rows).toEqual([]);
    await expect(
      db.query("insert into public.playback_preferences(user_id) values($1)", [a]),
    ).rejects.toThrow(/row.level security/i);
    await expect(upsert(10, 10, 5)).rejects.toThrow(); // other user's session ID cannot be reused
    expect((await db.query("select * from public.watch_progress")).rows).toEqual([]); // entire RPC rolled back
    await upsert(10, 10, 5, null);
    expect((await db.query("select position_s from public.watch_progress")).rows).toEqual([
      { position_s: 10 },
    ]);
    await identity(a);
  });
  it("rejects invalid timestamps/numbers and protects RPC execution from anonymous callers", async () => {
    await expect(upsert(-1, 10, 6)).rejects.toThrow();
    await expect(
      db.query("select public.upsert_progress($1,null,5,5,100,'infinity',null)", [content]),
    ).rejects.toThrow();
    await expect(
      db.query("select public.upsert_progress($1,null,'NaN',5,100,now(),null)", [content]),
    ).rejects.toThrow();
    await db.exec("reset role; set role anon");
    await expect(upsert(10, 10, 6, null)).rejects.toThrow(/permission/i);
    await identity(a);
  });
  it("converges concurrent progress writes and keeps completed history after rewinding", async () => {
    await Promise.all([upsert(95, 95, 7), upsert(40, 40, 8), upsert(10, 10, 9)]);
    expect(
      (await db.query("select position_s,furthest_position_s from public.watch_progress")).rows,
    ).toEqual([{ position_s: 10, furthest_position_s: 99 }]);
    expect((await db.query("select completed from public.watch_history")).rows).toEqual([
      { completed: true },
    ]);
  });
});
