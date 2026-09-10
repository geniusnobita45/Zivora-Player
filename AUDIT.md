# Zivora v1.0 Step 21 Audit

## Part A — raw command output

### 1. Git

```text
fatal: not a git repository (or any of the parent directories): .git
```

The requested `git status`, `git log`, and `git diff` commands cannot be completed because this workspace is not a Git checkout.

### 2. Line-count audit

```text
      1 features/ai/cache/index.ts
      1 features/ai/characters/index.ts
      1 features/ai/commands/index.ts
      1 features/ai/confidence/index.ts
      1 features/ai/dialogue/index.ts
      1 features/ai/recap/index.ts
      1 features/ai/scene-search/index.ts
      1 features/recommendations/index.ts
      1 lib/supabase/index.ts
      1 services/degradation/index.ts
      1 types/result.ts
      2 components/player/controls/SeekBar.tsx
      2 database/functions/006_intelligence.sql
      2 database/indexes/002_publication.sql
      3 database/indexes/008_ai_retrieval.sql
      3 database/policies/003_subtitle_variants.sql
      3 features/ai/spoiler-guard/index.ts
      4 app/(marketing)/layout.tsx
      4 app/api/ai/ask/route.ts
      4 app/api/ai/command/route.ts
      4 pipeline/intelligence/index.ts
      5 app/api/ai/recap/route.ts
      5 app/api/bookmarks/route.ts
      5 app/api/progress/route.ts
      5 features/ai/orchestrator/index.ts
      5 features/ai/retrieval/index.ts
      5 pipeline/ingest/index.ts
      6 database/indexes/005_observability.sql
      6 database/schema/003_subtitle_variants.sql
      6 features/analytics/index.ts
      6 next-env.d.ts
      6 tailwind.config.ts
      7 components/player/timeline/time.ts
      7 database/indexes/007_ai.sql
      7 database/policies/006_intelligence.sql
      7 database/schema/008_ai_retrieval.sql
      7 lib/r2/index.ts
      7 vitest.config.ts
      8 components/player/overlays/LoadingOverlay.tsx
      8 database/indexes/004_playback.sql
      9 app/api/ai/character/route.ts
      9 app/api/ai/dialogue/route.ts
      9 app/api/ai/scene-search/route.ts
      9 database/schema/002_publication.sql
      11 components/player/controls/NextEpisodeControl.tsx
      11 database/policies/008_ai_retrieval.sql
      12 components/player/controls/PlayControl.tsx
      12 database/indexes/004_playback.sql
      12 features/ai/confidence/ConfidenceService.ts
      12 features/ai/retrieval/VectorSearch.ts
      13 components/player/controls/TimeDisplay.tsx
      13 database/policies/004_playback.sql
      14 components/player/controls/PlayControl.tsx
```

Suspected stubs under the requested domains: all files under 15 lines listed above that are in `features/`, `services/`, `pipeline/`, or `database/`. Most are barrel exports or migration/index layers; no file was promoted to a P0 solely from line count.

### 3. Required checks

```text
WSL 1 is not supported. Please upgrade to WSL 2 or above.
Could not determine Node.js install directory
WSL 1 is not supported. Please upgrade to WSL 2 or above.
Could not determine Node.js install directory
WSL 1 is not supported. Please upgrade to WSL 2 or above.
Could not determine Node.js install directory
WSL 1 is not supported. Please upgrade to WSL 2 or above.
Could not determine Node.js install directory
```

`npm run typecheck`, `npm run lint`, `npm test`, and `npx playwright test --list` all stopped at the host Node/WSL bootstrap and did not execute project code. Exit status: 1.

### 4. Stub markers

```text
(no output)
```

### 5. Shaka imports

```text
./core/adapters/ShakaAdapter.ts
```

### 6. AI provider references

```text
./lib/ai/openai.ts
./lib/ai/index.ts
./lib/ai/anthropic.ts
./features/ai/gateway/OpenAIProvider.ts
./features/ai/gateway/ModelRouter.ts
./features/ai/gateway/createAIGateway.ts
./features/ai/gateway/AnthropicProvider.ts
```

### 7. Component/feature/app adapter imports

```text
components/player/PlayerSession.ts:6:} from "@/core/adapters/PlaybackRequestAuthorization";
components/player/timeline/TimelineCanvas.tsx:5:import type { BufferedRange } from "@/core/adapters/PlaybackAdapter";
components/player/WatchClient.tsx:5:import { playbackTransport } from "@/core/adapters/PlaybackRequestAuthorization";
```

## Part B — contract checklist

| Contract | Result | Evidence |
|---|---|---|
| PlayerEngine is the only module calling the adapter | PASS | `core/player/PlayerEngine.ts:252-435` owns adapter operations; `PlayerController.ts:114-147` dispatches to engine. |
| UI, keyboard, gesture, and AI actions create validated PlayerCommands | PASS | `core/player/PlayerController.ts:114-147,194-232`; `core/player/PlayerCommandValidator.ts:24-119`. |
| AI-sourced commands are rate limited | PASS | `core/player/PlayerCommandValidator.ts:67-104`. |
| No API route streams/proxies video bytes | PASS | `services/security/PlaybackRoute.ts:69-84` returns authorized URLs; media transport is client-side. |
| Progress is IndexedDB-first and survives Supabase failure | PASS | `services/sync/ProgressSync.ts:54-79,101-135`; `services/sync/OfflineProgress.ts:42-76`. |
| Degradation levels 0 to 4 exist and optional failures do not alter playback | PASS | `services/degradation/DegradationManager.ts:10-27,113-125,181-221`; no PlayerEngine reference. |
| SQL retrieval applies spoiler boundary in WHERE | PASS | `database/functions/008_ai_retrieval.sql:65` and `:136`. |
| Publication is transactional and rollback exists | PASS | `database/functions/002_publication.sql:104-151` and `:153-169`, with row locks and RPC transaction semantics. |
| Non-READY content is excluded from public queries | PASS | `services/security/WatchCatalog.ts:30,43,76,96`; `database/functions/008_ai_retrieval.sql:13-20`. |
| Playback token is short-lived and user/media-version bound | PASS | `services/security/PlaybackAuthorization.ts:65-75,150-158,180-196,214-225`. |
| Every table belongs to one of 7 domains | UNVERIFIED | Schema files are domain-grouped, but Git/DB execution is unavailable; no out-of-domain table was identified by static schema inspection. |
| Telemetry uses sendBeacon and never throws into playback | PASS | `services/telemetry/TelemetryService.ts:16-31,77-83`; fail-silent catches at `:88-95`. |
| AI cache key includes all required fields | PASS | `features/ai/cache/AICache.ts:20-44`. |

## Part C — smoke test

Added [tests/integration/smoke.test.ts](/mnt/c/Users/geniu/OneDrive/Desktop/Project/New%20folder%20(2)/tests/integration/smoke.test.ts), covering manifest load, play, controller seek, quality selection, validated AI seek, failing Supabase push with local IndexedDB persistence, and final `playing` state.

Execution could not start because Vitest is invoked through Node and the host reports:

```text
WSL 1 is not supported. Please upgrade to WSL 2 or above.
Could not determine Node.js install directory
```

## Prioritized fix list

### P0 — playback or security

None proven by this audit. No P0 changes were made.

### P1 — contract rules

1. Remove the three `components/player/*` imports from `core/adapters/*` by routing those concerns through the permitted player/application boundary.
2. Make the database-domain table inventory executable in CI and verify every `CREATE TABLE` against the seven allowed domains.
3. Restore a Git checkout or provide repository history so the requested change-scope audit can be evidenced.

### P2 — quality

1. Replace or explicitly document the suspected barrel/export stubs listed in Part A.2.
2. Run formatting and the complete test matrix under WSL2/Node.

## Part D — post-fix rerun

There were no P0 findings, so no P0 fixes were applicable. The Part A.3 rerun has the same host-level failure:

```text
WSL 1 is not supported. Please upgrade to WSL 2 or above.
Could not determine Node.js install directory
```
