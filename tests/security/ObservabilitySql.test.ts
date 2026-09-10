// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  renderAuthCatalogMediaMigration,
  renderObservabilityMigration,
  renderPlaybackMigration,
  renderPublicationMigration,
  renderSubtitleMigration,
} from "@/database/migrations/build";

const user = "11111111-1111-4111-8111-111111111111";
const content = "22222222-2222-4222-8222-222222222222";
const session = "33333333-3333-4333-8333-333333333333";
describe("OBSERVABILITY SQL", () => {
  const db = new PGlite();
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
      renderObservabilityMigration,
    ])
      await db.exec(await render(root));
    await db.query("insert into auth.users(id) values($1)", [user]);
    await db.query(
      "insert into public.content(id,type,title,state) values($1,'movie','Observability fixture','READY')",
      [content],
    );
  }, 30000);
  afterAll(async () => db.close());
  it("keeps direct analytics data inaccessible and computes all requested metrics for service role", async () => {
    await db.exec("set role service_role");
    await db.query(
      `insert into public.playback_events(session_id,user_id,content_id,occurred_at,event_type,startup_ms,watch_duration_ms,total_buffer_ms,device,browser,os,network,payload) values($1,$2,$3,now(),'session_started',1000,10000,100,'desktop','Chrome','Linux','4g','{}'),($1,$2,$3,now(),'session_snapshot',null,10000,100,'desktop','Chrome','Linux','4g','{}')`,
      [session, user, content],
    );
    await db.query(
      "insert into public.seek_events(session_id,user_id,content_id,occurred_at,from_position_s,to_position_s,latency_ms,device,browser,network) values($1,$2,$3,now(),1,10,25,'desktop','Chrome','4g')",
      [session, user, content],
    );
    await db.query(
      "insert into public.buffering_events(session_id,user_id,content_id,occurred_at,duration_ms,device,browser,network) values($1,$2,$3,now(),100,'desktop','Chrome','4g')",
      [session, user, content],
    );
    await db.query(
      "insert into public.playback_errors(session_id,user_id,content_id,occurred_at,code,category,fatal,recoverable,device,browser,network) values($1,$2,$3,now(),'NET','network',false,true,'desktop','Chrome','4g')",
      [session, user, content],
    );
    await db.query(
      "insert into public.quality_events(session_id,user_id,content_id,occurred_at,rendition_id,rendition_height,rendition_bitrate,bandwidth_estimate,device,browser,network) values($1,$2,$3,now(),'720p',720,2000000,4000000,'desktop','Chrome','4g')",
      [session, user, content],
    );
    expect(
      (await db.query("select p50_ms,p95_ms from public.analytics_video_startup_time")).rows[0],
    ).toMatchObject({ p50_ms: 1000, p95_ms: 1000 });
    expect(
      (await db.query("select p50_ms from public.analytics_seek_response_time")).rows[0],
    ).toMatchObject({ p50_ms: 25 });
    expect(
      (await db.query("select ratio from public.analytics_rebuffer_ratio")).rows[0],
    ).toMatchObject({ ratio: 0.01 });
    expect(
      (await db.query("select error_rate from public.analytics_playback_error_rate")).rows[0],
    ).toMatchObject({ error_rate: 1 });
    expect(
      (await db.query("select rendition_id from public.analytics_average_selected_quality"))
        .rows[0],
    ).toMatchObject({ rendition_id: "720p" });
    await db.exec("reset role; set role authenticated");
    await expect(db.query("select * from public.playback_events")).rejects.toThrow(/permission/i);
    await expect(db.query("select * from public.analytics_video_startup_time")).rejects.toThrow(
      /permission/i,
    );
  });
});
