# Zivora AI Player Architecture v1.0 (Frozen)

STACK: Next.js 15 App Router, TypeScript strict, Tailwind, Zustand, Zod, Shaka Player, Supabase (PostgreSQL, Auth, RLS, pgvector), Cloudflare R2 (S3 API), Vercel. Local tooling: FFmpeg, FFprobe, LosslessCut-style lossless merge. Tests: Vitest + Playwright. No FastAPI, Redis, Kafka, Kubernetes, microservices, separate vector DB, or custom streaming server.

ARCHITECTURE CONTRACT (from AGENTS.md, non-negotiable):

- Playback is the highest-priority system. PlayerEngine owns playback behavior.
- Shaka is isolated behind core/adapters/ShakaAdapter.ts. React components and AI cannot access Shaka directly.
- All actions (UI, keyboard, gesture, AI) become validated PlayerCommands -> CommandValidator -> PlayerController -> PlayerEngine.
- Video bytes go directly Cloudflare R2 -> client. Never proxy video through Next.js, Supabase or AI.
- AI, analytics, and sync must be removable without affecting playback. If any fails, playback continues; progress is preserved locally.
- Expensive intelligence is generated at ingestion. Spoiler filtering happens in SQL before retrieval reaches the LLM.
- AI providers are replaceable behind features/ai/gateway.
- Live media assets are immutable and versioned; publishing is validated, atomic, and reversible.
- Every production playback session emits telemetry.

FOLDER STRUCTURE (single Next.js repo, path alias @/):

app/ (marketing), browse, search, title/[contentId], watch/[contentId], library, history, settings, api/{auth,content,playback,progress,bookmarks,telemetry,ai/{ask,scene-search,character,dialogue,recap,command}}
core/player/{PlayerEngine,PlayerController,PlayerCommand,PlayerCommandValidator,PlayerEvents,PlayerErrors,PlayerConfig}.ts
core/adapters/ShakaAdapter.ts core/streaming/{ManifestManager,QualityManager,TrackManager,BufferMonitor}.ts
core/playback/{ProgressManager,ResumeManager,BookmarkManager,HistoryManager}.ts
components/player/{ZivoraPlayer,VideoSurface,PlayerOverlay}.tsx + controls/ timeline/ gestures/ subtitles/ overlays/ accessibility/
components/ai/{ZivoraAI.tsx, SceneSearch/, Recap/, Character/, Dialogue/, Commands/} components/shared/
features/ai/{gateway,orchestrator,spoiler-guard,retrieval,scene-search,characters,dialogue,recap,commands,confidence,cache}/
features/{subtitles,recommendations,history,bookmarks,analytics}/
stores/{player,ai,subtitle,user}.store.ts
services/telemetry/{TelemetryService,PlaybackMetrics,ErrorReporter}.ts services/sync/{ProgressSync,OfflineProgress}.ts services/security/PlaybackAuthorization.ts
lib/{supabase,r2,ai,utils}/
pipeline/{ingest,media,intelligence,validation,publish}/
database/{migrations,schema,functions,indexes,policies}/
tests/{player,streaming,gestures,long-video,ai,spoiler-guard,pipeline,security,integration}/
scripts/{zivora-ingest.ts,process-video.sh,validate-media.sh,publish-video.sh}
types/ config/ AGENTS.md README.md

DATABASE DOMAINS: AUTH(profiles, preferences) CATALOG(content, shows, seasons, episodes, genres) MEDIA(media_versions, manifests, renditions, audio_tracks, subtitle_tracks, thumbnails) PLAYBACK(watch_progress, watch_history, bookmarks, playback_sessions, playback_preferences) INTELLIGENCE(transcripts, transcript_segments, scenes, scene_embeddings, characters, character_appearances, chapters, skip_segments, recap_segments, entities) AI(ai_conversations, ai_messages, ai_cache, ai_usage, ai_preferences) OBSERVABILITY(playback_events, playback_errors, buffering_events, seek_events, quality_events). No tables outside these domains.

CONTENT STATES: UPLOADED -> PROCESSING -> AI_PROCESSING -> VALIDATING -> READY | FAILED. Never expose non-READY content.

RULES: Complete file contents with paths, no placeholders or TODOs, Zod at every external boundary, core/ has zero React imports, Vitest tests for all logic, ESLint no-restricted-imports enforcing that only core/adapters may import shaka-player and only features/ai/gateway may import AI SDKs. Ask at most one clarifying question; otherwise decide and state it.

## How to work in this repo

- Keep playback dependencies in `core/`; `core/` must not import React. UI dispatches validated commands through `PlayerController`.
- Keep Shaka imports exclusively in `core/adapters/ShakaAdapter.ts`; keep provider SDK imports exclusively in `features/ai/gateway`.
- Put route handlers under `app/api`, domain behavior under `features`, reusable infrastructure under `services` or `lib`, and ingestion/publishing workflows under `pipeline`.
- Validate every external input with Zod, including route bodies, environment variables, media metadata, and AI responses.
- Add or update Vitest coverage for every pure logic change and Playwright coverage for user journeys. Run `npm run typecheck`, `npm run lint`, `npm test`, and `npm run format:check` before handoff.
- Never expose content unless its state is `READY`; never proxy media bytes through the application server.
