# Step 11 observability verification

## Observed locally

On 2026-09-09, all generated migrations 001–005 applied to an ephemeral embedded
PostgreSQL instance with the same `auth.uid()` helper and roles used by the SQL tests.
The checked-in `005_observability.sql` exactly matched its four source layers.

Seeded service-role data produced these aggregate results:

- Video startup: one 1,000 ms sample with p50/p95 of 1,000 ms.
- Seek response: one 25 ms sample with p50/p95 of 25 ms.
- Rebuffer ratio: 100 ms over 10,000 ms, or `0.01`.
- Playback error rate: one failed session out of one, or `1`.
- Selected quality: one `720p`, 720 px, 2 Mbps sample at a 4 Mbps bandwidth estimate.

The tracker was also executed with deterministic local timing. Its Zod-validated beacon
batch contained startup, active watch duration, total buffer time, a seek latency, a
quality change, a network error code, a failed-request count, and completion percentage.
The original error message was absent from the serialized payload.

## Automated coverage added

- `tests/player/TelemetryService.test.ts`: tracker timing, snapshots across periodic
  flushes, fail-silent transport behavior, error redaction, metric formatting, and
  trusted admin-claim recognition.
- `tests/security/TelemetryRoute.test.ts`: strict batch validation, bounded request
  behavior, cross-origin rejection, verified identity replacement, and fail-silent
  storage response.
- `tests/security/ObservabilitySql.test.ts`: service-only table/view access plus all
  five aggregate views.
- `tests/integration/DatabaseMigration.test.ts`: generated migration/source equality
  and service-only security assertions.

## Boundaries

- No hosted Supabase migration, production telemetry ingest, R2 access, or Vercel
  deployment was performed.
- The admin route requires a real Supabase user with trusted
  `app_metadata.is_admin === true`; the visual dashboard journey cannot be exercised
  locally without that authenticated configuration.
- Browser `sendBeacon` delivery is intentionally best-effort. Beacon refusal, unload
  interruption, validation failure, and storage failure are dropped by design so that
  they cannot degrade playback. There is no local retry queue.
- The aggregate dashboard refreshes on page load. It has no raw-event drill-down,
  filter, export, or mutation surface in this minimal scope.
