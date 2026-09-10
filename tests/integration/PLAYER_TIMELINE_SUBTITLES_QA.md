# Steps 8–9 timeline and subtitle verification

## Observed test results

The final Chromium run passed all 10 journeys in 3.1 minutes after the pointer-zoom
keyboard-anchor fix. The final long-video run passed all 16 tests across two files.

The full Vitest run passed 312 tests across 33 files; the embedded PostgreSQL suite
hit its 30-second initialization hook limit and skipped its four tests while browser
and other checks were running. With browser work stopped, the unchanged SQL suite
passed all four tests (7.0 seconds of test execution). The extra anchor regression
was added after the full run and passed in the 16-test long-video run. Together these
runs exercise all 317 current tests; this is not a claim of one clean full-suite run.
ESLint and the full Prettier check passed after the final implementation changes.
The Next.js 15.5.25 production build also passed, including its lint/type gates,
static page generation, and dynamic watch/API route compilation.
The separate `npm run typecheck` invocation passed after the production build.

## Scope and evidence

Verified locally on 2026-09-09 using the production watch components, controller,
engine, and Shaka adapter. Chromium decodes a checked-in 32-second HLS/CMAF fixture;
only catalog/authorization metadata and external media transport are intercepted.
Tests do not run encoding, use cloud credentials, or enable production bypasses.

The ten browser journeys cover the existing desktop playback controls, responsive
resume and settings at 390x844, 768x1024, and 844x390, authorization retry, touch
gestures, and next-episode cancellation, plus:

- Pointer-centered wheel/hold zoom, sprite preview, chapter and scene labels,
  release-only seeking, and Escape cancellation.
- Original/literal/natural subtitle selection, speaker names, context hints,
  caption size/placement, and preference restoration after reload.
- Malformed custom-caption metadata falling back to native captions while decoded
  playback continues, without uncaught page errors.

Inspected desktop and phone settings/caption screenshots, the zoomed timeline
preview, and top-positioned translated captions with speaker/hint presentation.
Settings fit the phone viewport; captions remain readable over the test pattern;
canvas markers and density-limited DOM labels remain distinct. The frontend skill
guided accessible controls and responsive presentation; browser QA guided explicit
failure-path checks rather than relying on screenshots alone.

Unit coverage includes all four 24-hour window spans, edge clamping, time/pixel
round trips, fractional keyboard precision, dense marker inventories, pinch/hold
cancellation, and keyboard stepping from the pointer zoom anchor. Subtitle tests
cover WebVTT parsing and safe text rendering, offset/linear drift correction,
ambiguous language detection, offline variants, speaker/hint metadata, per-user
storage isolation, indexed cue lookup, renderer exceptions, and native fallback.

Migration tests compare generated SQL with its source layers. Executable embedded
PostgreSQL tests apply migrations 001–003 and exercise publication, rollback,
immutability, access boundaries, legacy subtitle defaults, and variant constraints.

## Reproduction

```bash
npm test -- --pool=threads --maxWorkers=2 --minWorkers=2
npx playwright install --with-deps chromium
npm run test:e2e -- tests/integration/PlayerWatch.spec.ts --workers=2
npm run build
npm run typecheck
npm run lint
npm run format:check
```

Do not run the dev server and production build concurrently against `.next`.
Screenshots and retained failure traces are under `test-results/`; later runs may
replace them. The default Playwright HTML report is opened with
`npx playwright show-report`.

## Boundaries and deployment checks

- The 24-hour duration is verified with pure math and a mock adapter, not a 24-hour
  real-media decoding endurance run. Physical touch devices, Safari/iOS, native
  OS PiP, and DRM need their own environments.
- Timeline chapters, scenes, bookmarks, skip regions, and sprite URLs are supplied
  through the validated timeline metadata boundary. This step does not generate
  intelligence or add a bookmark retrieval/CRUD service.
- Subtitle preferences are stored locally under an authenticated user UUID or a
  separate guest key. Cross-device synchronization is not implemented here.
- Language detection is conservative and returns `und` for uncertain samples.
  Translations must be supplied as offline cue variants or by an injected offline
  translator; there is no playback-time translation request.
- Migration `003_subtitle_variants.sql` must be applied after 001 and 002 before
  publishing enriched tracks. No external database was changed by this work.
- No live Supabase/R2/Vercel deployment, storage permissions, CORS, entitlement,
  token renewal, telemetry delivery, or real encoding run is certified by these
  fixture-based checks.
