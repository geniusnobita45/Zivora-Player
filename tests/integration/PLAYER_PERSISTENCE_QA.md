# Step 10 playback persistence verification

## Scope

Verified locally on 2026-09-09. The frozen player/controller/adapter boundaries are
unchanged. Persistence is an optional session dependency; its health channel cannot
raise a playback error. The frontend skill guided keyboard-accessible bookmark
controls and responsive layout; browser QA guided reload, offline, and failure-path
checks. Supabase guidance informed owner-scoped RLS and caller-privileged RPCs.

## Observed automated checks

The full Vitest run passed **343 tests across 39 files** in 862.67 seconds, including
both executable PostgreSQL suites in the same run. Standalone TypeScript, ESLint
(no warnings), and the repository-wide Prettier check passed.

The Next.js 15.5.25 production build passed, including build-time lint/type checks,
all nine generated pages, build traces, and compilation of the dynamic watch,
progress, and bookmarks routes. The dev server was stopped before building.

New and extended tests exercise:

- Latest-timestamp conflict resolution with a monotonic furthest position, ties,
  rewinds, and cross-user/target rejection.
- IndexedDB persistence across reopen, offline coalescing, stale acknowledgements,
  online-event flush, exponential retry, guest isolation, and memory fallback.
- Local-first checkpoints every five seconds while playing and on pause, seek,
  and disposal; paused tabs do not generate periodic competing timestamps.
- Bookmark journals, tombstones, retries, stale responses, history completion,
  resume thresholds, and storage/health-observer failure isolation.
- Migration/source equality, all five PLAYBACK RLS policies, direct-update
  high-water protection, RPC atomicity, concurrent writes, and session ownership.
- Bounded Zod-validated API input/output, owner spoofing, cross-origin rejection,
  private/no-store responses, caller-token Supabase clients, and malformed database
  acknowledgements.

The homepage smoke check returned HTTP 200 with meaningful Zivora content, no page
errors, and no Next.js error overlay. An earlier probe reached the server before
startup completed and received connection refused; it passed after the Ready signal.

The final Chromium run passed **all 12 browser journeys in 4.7 minutes**, using one
worker. Both new journeys passed: offline progress/bookmarks survive reload, resume,
and replay after reconnection; phone-sized keyboard navigation adds, jumps to, and
removes a long-named bookmark with reduced motion enabled. Existing real-HLS,
fullscreen, auto-hide, three responsive layouts, authorization retry, touch gestures,
auto-next, precision timeline, subtitle variants, and native-caption fallback checks
also passed without uncaught page errors. An earlier two-worker run had one touch
visibility assertion failure; it passed in isolation and in this final full run.
No gesture implementation or assertion was weakened to obtain the pass.

Inspected the final desktop offline-bookmark and 390x844 phone-bookmark screenshots.
Long bookmark titles wrap without horizontal overflow, focus is visible, and settings
scroll to keep add/jump/remove controls reachable. Timeline bookmark markers remain
visible below the settings panel.

## Reproduction

```bash
npm test -- --pool=threads --maxWorkers=2 --minWorkers=2
npx playwright install --with-deps chromium
npm run test:e2e -- tests/integration/PlayerWatch.spec.ts --workers=1 --reporter=line
npm run build
npm run typecheck
npm run lint
npm run format:check
```

Do not run the dev server and production build concurrently against `.next`.
Browser screenshots and retained failure traces are written to `test-results/`;
later runs replace them. The media is a checked-in 32-second HLS/CMAF fixture decoded
by Chromium. Catalog, authorization, progress, bookmarks, and external media
transport are intercepted without introducing a production bypass.

## Boundaries and release notes

- Apply generated migration `004_playback.sql` after 001–003 in the target Supabase
  project. No hosted migration, R2 write, or Vercel deployment was performed.
- SQL tests use embedded PostgreSQL with simulated `auth.uid()` and database roles;
  they are not a live Supabase JWT/PostgREST integration test.
- Physical iOS/Safari and abrupt process-kill durability were not tested. Unload
  writes the synchronous journal first; asynchronous IndexedDB/network completion
  is not guaranteed by browsers. If storage is unavailable or full, memory fallback
  protects ongoing playback but cannot survive tab disposal.
- Guest records stay local. Signed-in queues remain owner-scoped. Late remote
  restore results update persistence without seeking an already-running video.
- The five PLAYBACK tables are present; this step adds progress/bookmark endpoints,
  not a new cross-device preferences endpoint or a history-page API.
- The dependency audit reported seven existing dependency-path findings (four
  moderate, two high, one critical), including a Vitest UI-server advisory. Added
  `idb` and `fake-indexeddb` were not listed. No force-fix or framework upgrade was
  applied; development/test servers must not be exposed to untrusted networks.
