# Playback analytics dashboard brief

## Outcome

- Product / surface: `/settings/analytics` playback-health dashboard.
- Primary user and context: an authenticated Zivora administrator reviewing production delivery health.
- Job to be done: When delivery quality may be degrading, an administrator needs to scan startup, seek, buffering, error, and rendition data so that they can identify the affected environment.
- Critical action or decision: decide whether to investigate an error, delivery network, or rendition issue.
- Success signal: the five defined SQL metrics and rendition grouping are readable without exposing individual viewing history.
- Error cost: presenting stale or unauthorized metrics could cause incorrect operational decisions or disclose private telemetry.
- In scope / out of scope: read-only aggregate metrics and a graceful unavailable state; no exports, filters, mutations, or raw-event drill-down.

## Repository and constraints

- Framework and rendering model: Next.js 15 App Router, server-rendered dynamic route.
- Existing design system and dependencies: Tailwind utility styling; no chart or UI dependency added.
- Routes and data contracts: service-only `analytics_*` SQL views validated by `PlaybackMetricsSchema`.
- Authentication, authorization, tenancy, and privacy: server checks trusted Supabase `app_metadata.is_admin`; service role is used only after that check. Raw user agent, error text, URL, stack, and IP are excluded.
- Supported browsers, devices, locales, and accessibility target: modern desktop-first admin use with responsive table overflow, semantic headings, and a table caption.
- Performance budget and deadline/capacity: one parallel read of five aggregate views; quality rows capped at 100.

## Journey

- Entry point: a direct `/settings/analytics` visit by an administrator.
- Information needed: metric units, sample counts, grouping dimensions, and temporary-unavailable state.
- Primary and secondary actions: scan cards, then compare the rendition table; refresh the page to get a new server read.
- Exit condition: the administrator has enough aggregate evidence to begin an operational investigation.
- Permissions and consequences: unauthorized users are redirected server-side; the page is read-only.
- Common detours, failures, and recovery: missing or unavailable service data shows an explicit recovery message while playback remains independent.

## State model

| State          | Owner                 | Persistence         | Failure and recovery                                  |
| -------------- | --------------------- | ------------------- | ----------------------------------------------------- |
| Route access   | Server authentication | Supabase session    | Redirect non-admin users to `/`                       |
| Metrics        | Server data           | SQL aggregate views | Present unavailable state and refresh                 |
| Table overflow | View                  | None                | Horizontal scroll preserves columns on narrow screens |

## Experience direction

- Design thesis: a calm, high-contrast operational readout that makes delivery regressions easier to spot than a general settings page.
- Semantic palette: near-black surface, slate structure, white values, violet identity, amber unavailable warning.
- Typography roles: compact uppercase labels, tabular numeric values, readable operational body copy.
- Density and layout: four primary cards, one secondary row, then a scanable data table.
- Signature element and reason: the typed metric cards establish a single fast scanning rhythm before the detail table.
- Motion and reduced-motion behavior: no nonessential motion.

## Acceptance and evidence

| Criterion                                          | Evidence method                    | Status                   |
| -------------------------------------------------- | ---------------------------------- | ------------------------ |
| Admin gate is server-side and trusted              | Unit/source and route verification | Implemented              |
| Aggregate cards name formula units and counts      | Server page inspection             | Implemented              |
| Quality grouping is available as a captioned table | Server page inspection             | Implemented              |
| Unavailable state is explicit and non-blocking     | Server page inspection             | Implemented              |
| Keyboard and narrow responsive interaction         | Browser verification               | Pending final Step 11 QA |
