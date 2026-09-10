# Step 7 playback verification

## Observed results

The final Chromium run on 2026-09-08 passed all seven watch journeys in 1.8 minutes.
It used the production watch components, controller, engine, Shaka adapter, and browser
media decoder. Test routes intercepted catalog/authorization metadata and served the
checked-in HLS/CMAF fixture from an external test origin. No production demo switch,
cloud credentials, or encoding was involved.

- Desktop: decoded playback advances, pause, speed, quality/audio/subtitle menus,
  large captions, seeking, fullscreen, auto-hide, and next-episode navigation.
- Phone (390x844), tablet (768x1024), and landscape (844x390): local resume, modal
  keyboard focus, settings layout bounds, and no horizontal overflow.
- Authorization failure: a retryable error remains on the watch route; retry starts
  real playback after the metadata request succeeds.
- Touch: single tap, double-tap seek, temporary 2x playback with rate restoration,
  and vertical volume swipe.
- Ended playback: the next-episode countdown can be cancelled; explicit navigation
  remains usable afterward.

Screenshots of desktop captions/settings, responsive resume/settings, and the error
state were visually inspected. Native captions remained above visible controls;
phone controls wrapped and landscape settings remained scrollable. The journeys
asserted no uncaught page errors and observed direct external `.m4s` requests.

The complete Vitest run passed 281 tests across 29 files. After adding the native
caption re-entrancy regression, the caption-placement and player-UI suites passed
all seven tests. These are separate runs, not a claim of a single 282-test run.
Unit coverage also includes controller-only actions, StrictMode lifecycle cleanup,
gesture cancellation, local-storage failure isolation, resume/retry preservation,
telemetry failure isolation, and READY-only watch metadata.

On 2026-09-09, the production build, standalone TypeScript check, ESLint, and Prettier
check all passed. Next.js 15.5.25 built the dynamic watch route and playback API
successfully. No deployment or live-cloud mutation was performed.

## Reproduction

```bash
npm test -- --pool=threads --maxWorkers=2 --minWorkers=2
npx playwright install --with-deps chromium
npm run test:e2e -- tests/integration/PlayerWatch.spec.ts --workers=2
npm run typecheck
npm run lint
npm run format:check
npm run build
```

Playwright writes screenshots and retained failure traces under `test-results/`.
Its default HTML report is available with `npx playwright show-report`. Artifacts
are ignored by version control and may be replaced by later test runs. The fixture
generation script is only for explicit fixture maintenance; tests never invoke it.
Do not run a production build and a development server concurrently against `.next`.

## Deployment checks still required

These local results do not verify live Supabase/R2 permissions, CORS, entitlement
configuration, signed-URL renewal against R2, telemetry delivery, or a Vercel
deployment. Native PiP, Safari/iOS media behavior, physical touch devices, and DRM
require their own supported environments. The fixture run must not be treated as
production compatibility or cloud-security certification.
