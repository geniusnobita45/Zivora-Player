# Zivora v1.0 deployment checklist

Deploy only an immutable, reviewed commit after every gate below passes. Record the commit SHA, migration set, R2 media-version identifiers, operator, and UTC deployment time in the release record.

## Vercel

- Pin Node.js 22 and install from the committed lockfile with `npm ci`.
- Configure `NEXT_PUBLIC_SUPABASE_URL` and the Supabase publishable/anon key for browser use. Configure the service-role key, R2 credentials, playback signing secret, AI provider keys, and telemetry values only as encrypted server variables; no privileged value may use the `NEXT_PUBLIC_` prefix.
- Run `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm test`, `npm run build`, and `npm run bundle:audit` against the exact commit.
- Confirm `/manifest.webmanifest` and `/sw.js` return `200`; `sw.js` must be served with `Cache-Control: public, max-age=0, must-revalidate`.
- Smoke-test cold playback, resume, seek, track switching, optional-service failure, telemetry acceptance, and a second load after rollback. Stop rollout on elevated playback error rate, startup p95 regression, or authorization failures.
- Roll back the Vercel deployment independently of media. Application rollback must not mutate or delete R2 version prefixes.

## Supabase

- Apply generated migrations in numeric order with a migration-role connection. Record `select version from supabase_migrations.schema_migrations order by version;` after application.
- Run database advisors, then verify every exposed base table has RLS enabled:

```sql
select c.relname, c.relrowsecurity
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by c.relname;
```

- Verify anonymous and authenticated roles cannot read service-only tables while `public_catalog` returns READY content only:

```sql
set local role anon;
select count(*) from public.public_catalog;
select count(*) from public.media_versions; -- must fail with insufficient privilege
reset role;

select count(*)
from public.public_catalog pc
where not exists (
  select 1 from public.content c
  join public.media_versions mv on mv.id = c.active_media_version_id
  where c.id = pc.id and c.state = 'READY' and mv.state = 'READY'
); -- must return 0
```

- With two test users, verify `watch_progress`, `watch_history`, `bookmarks`, `playback_preferences`, AI conversations/messages/preferences, and every user-readable row reject the other user's ID. Verify update policies include both `using` and `with check` ownership predicates.
- Confirm search RPCs filter episode order and segment end before ranking, and service-only functions are revoked from `public`, `anon`, and `authenticated`.
- Exercise `publish_media_version`, capture the previous active ID, exercise `rollback_media_version`, and verify the pointer returns atomically without changing either immutable media row.

## Cloudflare R2

- Use distinct public and private buckets. Disable public development URLs and custom domains on the private bucket.
- Allow CORS only from production and approved preview origins, methods `GET` and `HEAD`, request headers `Range`, `If-None-Match`, and `If-Modified-Since`, and expose `Accept-Ranges`, `Content-Length`, `Content-Range`, `ETag`, and `Last-Modified`.
- Verify response metadata by asset class:

| Asset                  | Content-Type                                     | Cache-Control                         |
| ---------------------- | ------------------------------------------------ | ------------------------------------- |
| Master/child playlist  | `application/vnd.apple.mpegurl`                  | `public, max-age=60`                  |
| CMAF init and segments | `video/mp4`, `audio/mp4`, or `video/iso.segment` | `public, max-age=31536000, immutable` |
| Subtitles              | `text/vtt; charset=utf-8`                        | `public, max-age=31536000, immutable` |
| Thumbnails/sprites     | matching image type                              | `public, max-age=31536000, immutable` |

- Confirm every live object is under `media/<contentId>/<episodeId?>/v<N>/`, PUT uses `If-None-Match: *`, and no deployment process overwrites or deletes an existing prefix.
- From each production origin, test an OPTIONS preflight, ranged GET, first/last rendition segments, and manifest references. Confirm video requests travel directly from R2 to the browser and never through Vercel or Supabase.

## Post-deploy evidence

- Preserve Playwright HTML report, failure traces, bundle-audit JSON, migration output, RLS query output, R2 header samples, and Vercel deployment ID.
- Observe startup p50/p95, seek latency, rebuffer ratio, selected quality, and playback error rate for the release window. Roll back the application or media pointer according to the failing layer.
