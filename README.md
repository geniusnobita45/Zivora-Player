# Zivora AI Player

Single-repository Next.js 15 App Router implementation of Zivora AI Player Architecture v1.0.

## Development

```bash
npm install
cp .env.example .env.local
npm run dev
```

## Verification

```bash
npm run typecheck
npm run lint
npm run format:check
npm test
npm run test:e2e
npm run build
```

Environment variables are validated by `config/env.ts`. Required Supabase and Cloudflare R2 values must be present before importing the loader. AI and telemetry integrations are optional.

## Playback core and commands (Steps 2–3)

Application code uses `PlayerController` as its sole playback API. The engine owns exactly one adapter and all playback behavior. Shaka is lazy-loaded inside `core/adapters/ShakaAdapter.ts`. Import restrictions enforce these layers, including dynamic imports; `core/` has no React or optional AI/analytics/sync dependencies.

```ts
import { PlayerController } from "@/core/player/PlayerController";

export async function startPlayback(video: HTMLVideoElement, manifestUrl: string) {
  const controller = PlayerController.forVideo(video);
  await controller.load(manifestUrl);
  return controller;
}
```

Use helpers such as `play()`, `pause()`, `seekTo(seconds)`, `seekBy(delta)`, `setVolume(level)`, `setPlaybackRate(rate)`, `selectQuality(id)`, `enableAutoQuality()`, `selectAudio(lang)`, `selectSubtitle(langOrNull)`, `toggleFullscreen()`, and `togglePictureInPicture()`. Helpers accept optional `{ source, reason }` metadata, defaulting to UI source. Native fullscreen and PiP requests should originate in user gestures.

Raw `dispatch(command)` requires `source: "ui" | "keyboard" | "gesture" | "ai"` and `issuedAt` (Unix milliseconds); `reason` is optional. Every command has its own strict Zod shape. Rates are 0.25–3, volume is 0–1, and seek positions are clamped to the current duration. Audio/subtitle commands select by language, with exact matching before a base-language fallback. `SELECT_SUBTITLE` with `lang: null` disables captions. Register ingestion-provided skip segments with `setSkipSegments([{ id, start, end }])` after loading media; `SKIP_SEGMENT` rejects unknown IDs and seeks to the bounded segment end.

`PlayerCommandValidator.parse(input, context)` always returns `Result<PlayerCommand, ValidationError>` and never throws. Each controller keeps its own validator: AI commands are limited to five per rolling ten seconds and one seek (including segment skips) per two seconds. Limits use receipt time from the validator's clock, not caller-supplied `issuedAt`; invalid or rejected commands do not consume quota. UI, keyboard, and gesture commands remain available. Loading another title does not reset the controller's AI limits.

`dispatch` and helpers resolve to `{ ok: true, value: command }` or `{ ok: false, error }`. Subscribe to `on("commandaudit", listener)` for correlated accepted/executed/rejected/failed records. Accepted commands are frozen, rejected raw payloads are not logged, and observer failures do not interrupt playback. `on` returns an unsubscribe function; `off` also removes listeners. The controller forwards typed playback events and provides `getSnapshot()` and `getStreamingSnapshot()`.

`handleKey(event)` maps Space/K to toggle playback, arrows left/right to ±5 seconds, J/L to ±10 seconds, arrows up/down to ±0.05 volume, M to mute, F to fullscreen, P to PiP, and 0–9 to 0–90% of duration. It ignores editable/interactive controls, modifiers, composition, and repeated toggle keys. `keyboardCommand` is also available as a pure command-producing map.

`swapAdapter(factory)` disposes the old adapter before creating a replacement. `destroy()` releases the adapter, metric timers, manifest authorization manager, and listeners. Engine recovery reloads the last manifest at the last confirmed position, preserving settings and play intent, with at most three recovery attempts per explicit load. Successful recovery and swaps do not reset the budget. Exhaustion preserves progress in the snapshot and emits `RECOVERY_EXHAUSTED`.

## Streaming helpers

- `ManifestManager` takes an authorization callback returning a Zod-validated `{ url, expiresAt }` signed manifest descriptor. It deduplicates requests, refreshes before expiry, retries failed authorization, bounds requests with abortable timeouts, and restricts renewals to the same immutable media origin/path. `healthCheck()` sends a direct HEAD request to the media origin; it never downloads or proxies video bytes.
- `controller.loadSignedManifest(manager)` takes ownership of that manager. Renewal updates the URL used for recovery without reloading active playback. For private R2 media, use the per-request URL authorization hook below; renewing a master signature alone does not sign its children. License headers remain a separate adapter hook.
- `QualityManager` validates rendition lists, records auto/manual changes, and keeps at most 100 change records. It never controls the adapter directly.
- `TrackManager` resolves languages and persists preferences under `zivora:track-preferences:v1`. Corrupt/blocked storage is ignored, and preferences continue in memory. Engine commands apply the resolved adapter track IDs.
- `BufferMonitor` measures contiguous buffer ahead, low/empty buffer health, stalls, and a bounded 120-sample bandwidth history. Sampling continues during missing media time events, ignores intentional pause/seeking, and cleans up its interval on destruction. Metric-read failures do not affect playback.

Run `npm test -- tests/player tests/streaming` for command, state-machine, recovery, keyboard, import-boundary, signed-manifest, preference, quality, and buffering tests. Browser presentation and Shaka tests simulate browser/SDK APIs; real-stream browser compatibility remains a separate Playwright verification step. These unit tests need no Supabase, R2, or AI credentials.

## Media pipeline

### End-to-end ingestion

The complete immutable ingest workflow is available through the TypeScript CLI:

```bash
npm run ingest -- movie.mp4 --content CONTENT_UUID --episode EPISODE_UUID
scripts/zivora-ingest.sh movie.mp4 --content CONTENT_UUID --skip-ai
```

It reports each frozen phase with elapsed time, writes JSONL events and a final
`zivora-ingest-report.json`, and marks content `FAILED` on any error without
changing the active media pointer. Use `--from STAGE` to resume from a named
phase, `--dry-run` to avoid Supabase/R2 mutations, and `--rollback --content ID`
to invoke the atomic rollback RPC. `--skip-ai` omits the seven intelligence
phases while retaining media validation and publication gates.

Install `ffmpeg` and `ffprobe` on the ingestion host, then create a new immutable media-version directory:

```bash
npm run media:process -- --input ./source/movie.mkv --output ./output/content-id/version-id
```

External SRT, ASS, SSA, or WebVTT files can be included with repeatable `--subtitle language=path` arguments. The pipeline probes the source, creates the frozen 1080p/720p/480p/360p H.264 ladder with two-second aligned keyframes, extracts every audio track as tagged AAC, normalizes subtitles to WebVTT, packages four-second HLS/CMAF media, and generates five-second JPEG thumbnails plus 10x10 sprites. Validation must pass before `.work` is removed and the create-once `zivora-media.json` descriptor is published with SHA-256 checksums.

The shell wrapper provides the same entry point:

```bash
scripts/process-video.sh --input ./source/movie.mkv --output ./output/content-id/version-id
```

Validate an existing package with a strict JSON request containing `mediaRoot`, `masterPlaylist`, `probeTarget`, `thumbnailVtt`, and optional `expectedDuration`:

```bash
npm run media:validate -- ./validation-request.json --write-descriptor
scripts/validate-media.sh ./validation-request.json --write-descriptor
```

Validation runs FFprobe, codec, duration, segment existence, segment-duration sum, audio, subtitle, and thumbnail checks in that order. Run `npm test -- tests/pipeline` for command construction, parsing, containment, validation, and descriptor tests; these fixtures do not invoke FFmpeg.

## Database migration

The AUTH, CATALOG, and MEDIA migration is maintained as four ordered source layers:

1. `database/schema/001_auth_catalog_media.sql`
2. `database/indexes/001_auth_catalog_media.sql`
3. `database/policies/001_auth_catalog_media.sql`
4. `database/functions/001_auth_catalog_media.sql`

Regenerate the migration artifact after changing any source layer:

```bash
npm run db:migration:build
```

The generated `database/migrations/001_auth_catalog_media.sql` is wrapped in one transaction. Base tables have RLS enabled and are inaccessible to `anon` and `authenticated`; those roles can read only the filtered `public_catalog` view. Publication and rollback RPCs are granted only to `service_role` and lock affected rows while moving the active version pointer.

Typed clients are separated by trust boundary: `lib/supabase/browser.ts` for Client Components, `lib/supabase/server.ts` for cookie-backed Server Components/Actions/Route Handlers, and `lib/supabase/service.ts` for server-only privileged operations. Never import the service client into client-side code.

## Publication and playback authorization (Step 6)

Apply generated migrations `001_auth_catalog_media.sql`, then `002_publication.sql` to Supabase using an administrator migration connection. Do not replay migration 001 on an existing database. The builder emits both artifacts; 002 concatenates its schema, indexes, functions and permissions in one transaction. It adds only fields/functions/indexes/triggers in the existing CATALOG/MEDIA domains. Base-table RLS and the public-view-only read boundary are preserved.

Version reservations use a database advisory lock and persist an `UPLOADED` row with a monotonically increasing version number. Prefixes are `media/<contentId>/v<N>/` or `media/<contentId>/<episodeId>/v<N>/`. Failed reservations remain reserved. An existing R2 prefix is refused, and every object PUT uses `If-None-Match: *`. Retrying publication allocates a new version; it never resumes by overwriting a partially uploaded prefix.

Set these server/ingestion-only values in the deployment environment (and export them before running the local CLI):

- Supabase URL and service-role key, and R2 account ID, access key, secret key and `R2_BUCKET_NAME`.
- `PLAYBACK_SIGNING_SECRET`: generate with `openssl rand -hex 32`. Never prefix this or any privileged key with `NEXT_PUBLIC_`.
- For public media only: `R2_PUBLIC_BUCKET_NAME` and `R2_PUBLIC_BASE_URL`. The public and private buckets **must differ**. Disable both public custom domains and r2.dev access on the private bucket; configure the public bucket's custom domain to match the base URL. The application cannot verify bucket-level public-access settings with an object-only credential.
- Configure CORS on both R2 buckets for the exact application origins, GET/HEAD, the Range header, and exposed Content-Length, Content-Range, Accept-Ranges and ETag headers. Browser media requests must reach R2 without a Next.js proxy.

New content defaults to `access_level='private'`; select public/private before reserving its first version. Access cannot change after reservation because published objects are immutable. Keep catalog state `READY` independently of media activation; publishing an episode does not silently approve a non-READY parent title.

```bash
npm run media:publish -- --directory ./output/package --content-id CONTENT_UUID --episode-id EPISODE_UUID
scripts/publish-video.sh publish --directory ./output/package --content-id CONTENT_UUID --episode-id EPISODE_UUID
npm run media:rollback -- --id EPISODE_UUID
scripts/publish-video.sh rollback --id CONTENT_OR_EPISODE_UUID
```

Omit `--episode-id` for content-level media. Playback authorization and publication support both content and episode versions. The CLI reads the process environment, not `.env.local` automatically; use an environment manager or Node's `--env-file=.env.local` when invoking the TypeScript entry point directly.

The publisher requires all eight ordered local validation checks in `zivora-media.json`. It verifies local hashes, uploads with four bounded workers, checks every object's HEAD metadata and re-downloads/hashes the uploaded bytes. Manifests have 60-second cache headers; other assets have one-year immutable headers. Cloud validation re-parses every master/child playlist, checks references, duration tolerance, codecs, audio/subtitle inventory and thumbnail coverage. It then fetches the init plus first/last segments of each rendition and audio track and checks fragmented-MP4 box structure. This is a structural sample-playback gate, not an FFmpeg decode or real-browser playback certification. Individual objects are limited to 128 MiB.

Only after those gates pass does registration atomically insert MEDIA rows/checksums. A READY RPC rechecks the inventory; publication atomically sets the active pointer and immutable previous-version link. Rollback moves that pointer back without deleting assets. Live versions and their child rows cannot be edited. On failure, unpublished reservations become FAILED and the previous active pointer stays unchanged; a lost successful publish response cannot mark the now-live version FAILED. Uploaded failure artifacts are retained for diagnosis, not automatically deleted.

### Playback API and adapter hook

`POST /api/playback` returns no-store JSON only. It accepts exactly one of:

```json
{ "action": "authorize", "episodeId": "EPISODE_UUID" }
{ "action": "authorize", "contentId": "CONTENT_UUID" }
{ "action": "catalog", "contentId": "CONTENT_UUID", "episodeId": "OPTIONAL_EPISODE_UUID" }
{ "action": "renew", "token": "SESSION_TOKEN" }
{ "action": "sign", "token": "SESSION_TOKEN", "paths": ["video/720p/segments/segment-000001.m4s"] }
```

Supabase cookies or a Bearer access token are verified using `auth.getUser()`. Private-content entitlement is the server-managed `user.app_metadata.content_ids` UUID list. Set that list through trusted Supabase administration; `user_metadata` and request-body claims are never accepted. There is no implicit subscription/admin bypass. `PlaybackAuthorization` accepts an injected entitlement checker for a future policy within the same boundary.

Private grants contain a 10-minute HMAC token bound to user, content, episode and media version, and a short-lived R2-signed master URL. Signing child objects rechecks the authenticated user, entitlement, READY/published status, and checksum inventory. Tokens cannot sign another version or an arbitrary key. Renewal retains the session's published immutable version even if a newer version becomes active. Public grants contain unsigned public URLs and no token.

[R2 presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/) authorize individual S3 API objects, not whole HLS trees or custom domains. The HMAC token authorizes the metadata API; it is never sent to R2. Individual R2 URLs are short-lived bearer capabilities, so do not log or share them. User binding is enforced when minting/renewing/signing, not by R2 on an already issued URL; revoking entitlement stops new grants but existing URLs remain usable until their expiry.

```ts
import { PlayerController } from "@/core/player/PlayerController";
import {
  PlaybackRequestAuthorization,
  playbackTransport,
} from "@/core/adapters/PlaybackRequestAuthorization";
import { PlaybackGrantSchema } from "@/types/playbackAuthorization";

export async function playEpisode(video: HTMLVideoElement, episodeId: string) {
  const grant = PlaybackGrantSchema.parse(
    await playbackTransport({ action: "authorize", episodeId }),
  );
  const authorization = new PlaybackRequestAuthorization(grant);
  const controller = PlayerController.forVideo(
    video,
    video,
    {},
    {
      authorizeRequest: authorization.authorizeRequest,
    },
  );
  await controller.load(grant.manifestUrl);
  return controller;
}
```

The request hook signs master/child/segment requests, bounds its URL cache and deduplicates renewal within the last minute before expiry. License requests bypass storage signing; the existing `getRequestHeaders` adapter option remains available for future DRM. No PlayerEngine change or direct Shaka import is needed. The default metadata transport uses same-origin cookies; Bearer-auth clients can inject a transport that adds their access token to the metadata API only.

Run `npm test -- tests/security` for publication, token, URL containment, SDK boundary and executable PostgreSQL tests. These use synthetic fMP4/playlist fixtures, an in-memory R2 test double and PGlite; no cloud credentials or encoding are required. Cloud configuration, real R2 behavior and real-device playback still require deployment verification.

## Watch experience (Step 7)

Open `/watch/<contentId>` for a published movie or the first published episode; use
`?episode=<episodeId>` to select an episode belonging to that title. The metadata-only
catalog action resolves current/next episodes by season and `order_index`, filtering
out versions that are not READY and published. It returns no privileged storage paths.
Omit `episodeId` entirely from a catalog request when choosing the default episode.
An authorization request must specify exactly one of `episodeId` or `contentId`.

`ZivoraPlayer` owns one controller per mounted player, including React StrictMode
teardown. Its context exposes commands; the controller owns the engine and Shaka
adapter. `stores/player.store.ts` creates an isolated Zustand store per player and
projects controller-forwarded engine events, tracks, qualities, buffering and UI state.
Store subscriptions and polling timers are removed on unmount. Parent rerenders do
not reload unchanged media.

All transport, keyboard, gesture, seek, track, quality, speed, fullscreen and PiP
actions use validated controller commands. Touch gestures: single tap toggles controls,
double tap seeks ten seconds toward the tapped side, hold plays at 2x until release,
and vertical swipe adjusts volume. Cancellation, lost capture and backgrounding restore
the previous rate. The native controls provide equivalent keyboard-accessible actions.
Fullscreen and PiP depend on browser support and user activation; failures appear as
nonfatal notices. Captions offer standard/large white-on-black styling; automatic native
cues move above visible controls, then return to their authored placement when controls hide.

Controls hide after three idle seconds of playback, but stay visible while paused,
focused, in settings, or showing an error/resume dialog. Resume dialogs trap focus and
restore it on close. Next-episode autoplay has a ten-second cancellable countdown that
pauses in background tabs; the explicit next button remains available after cancelling.

Progress is saved locally every five seconds and on pause, seek, end, visibility change,
page hide and teardown. Storage errors fall back to memory without blocking playback.
Resume is offered after five seconds and before the last ten seconds of the video.
Saved progress is not overwritten while waiting for the resume choice. Retry requests
a fresh grant and reloads at the last known position. No signed URL or token is persisted
in local progress. Production mounts attach the optional telemetry observer; failed
telemetry requests never block playback. Telemetry delivery is best-effort, not durable.

## Observability (Step 11)

Apply `database/migrations/005_observability.sql` after migrations 001–004. The five
OBSERVABILITY tables are service-only under RLS: browser clients post a bounded,
Zod-validated batch to `/api/telemetry`, and the route replaces any client-provided
user ID with the verified Supabase caller before service-side insertion. Invalid
batches receive `400`; valid batches always receive `202`, including when analytics
storage is unavailable, so playback telemetry never creates a retry loop or impacts
playback. Events store only coarse device/browser/OS/network classifications; raw user
agents, URLs, stack traces, error messages, causes, and IP information are excluded.

Production player sessions batch with `navigator.sendBeacon` every 30 seconds and at
session teardown/unload. They capture startup time, active watch duration, completion,
buffer duration, seeks, selected rendition/bandwidth estimate, failed media requests,
and structured playback error codes. Beacon refusal or any telemetry exception drops
the batch silently. No telemetry queue or retry is persisted locally.

`analytics_video_startup_time`, `analytics_seek_response_time`,
`analytics_rebuffer_ratio`, `analytics_playback_error_rate`, and
`analytics_average_selected_quality` are service-only, security-invoker SQL views.
The minimal dashboard is `/settings/analytics`; it is server-gated using the trusted
`app_metadata.is_admin === true` claim, then reads the views with the service role.
Do not use user-editable metadata to grant analytics access.

See [the Step 11 verification record](tests/integration/OBSERVABILITY_QA.md) for local
SQL evidence, test coverage, and deployment boundaries.

```bash
npm test -- tests/player tests/gestures tests/security
npx playwright install --with-deps chromium
npm run test:e2e -- tests/integration/PlayerWatch.spec.ts
```

Playwright tests use real Shaka and Chromium with checked-in, generated HLS/CMAF test
media from a mocked external origin. Only the catalog/authorization metadata and
external media transport are intercepted; production code has no demo-mode bypass.
No credentials or FFmpeg are needed to run these tests. Screenshots and failure traces
are written to `test-results/`; inspect the HTML report with `npx playwright show-report`.
The test fixture's generation script is for explicit fixture maintenance only.
These tests do not certify live Supabase/R2 permissions, CORS, entitlement, token
renewal or physical-device/browser-specific media behavior; verify those after deployment.

See [the Step 7 QA record](tests/integration/PLAYER_QA.md) for observed results,
reproduction commands, and the limits of the local verification.

## Precision timeline (Step 8)

See the [Steps 8–9 QA record](tests/integration/PLAYER_TIMELINE_SUBTITLES_QA.md)
for verification coverage, reproduction commands, and deployment boundaries.

The watch player supports durations up to 86,400 seconds. Hold the timeline to zoom
successively through GLOBAL, HOUR (60 minutes), MINUTES (5 minutes), and SECONDS
(30 seconds). Wheel and two-pointer pinch zoom around the pointer or midpoint.
Release commits the draft via `PlayerController.seekTo`; Escape, blur, or pointer
cancellation discards it. No intermediate drag seek reaches the engine. Keyboard
`+`/`-` changes zoom; arrows step 60, 10, 1, or 0.1 seconds at the respective levels,
with key release committing the draft. Home/End target the current window edges.

Pass a `TimelineDataSchema`-validated `timeline` prop to `ZivoraPlayer`, or include it
in the watch catalog response. It contains `chapters`/`scenes` (`id`, `title`, `start`,
`end`), `bookmarks` (`id`, `title`, `start`), `skipSegments` (chapter fields plus
`kind: intro|outro|recap|other`), and sprite `thumbnails` (`start`, `end`, `url`, `x`,
`y`, `width`, `height`). Arrays default to empty; the current catalog resolver does
not invent intelligence or bookmarks. Supply authorized direct-R2 sprite URLs from
the metadata owner; no image bytes pass through Next.js. Buffered ranges are actual
adapter samples, not an estimate stretched from the start of the video. Canvas draws
markers and DOM labels are density-limited. The pure math is in
`core/streaming/TimelineMath.ts`; tests live under `tests/long-video`.

## Offline and custom subtitles (Step 9)

Apply `database/migrations/003_subtitle_variants.sql` after migrations 001 and 002.
It adds `subtitle_tracks.kind` (`original|literal|natural`), `has_speaker_names`, and
`has_context_hints`, and extends atomic registration without changing table grants,
RLS, active pointers, or live asset immutability. Regenerate migration artifacts with
`npm run db:migration:build`; the source layers remain under `database/`.

`media:process` enriches original WebVTT tracks offline. Unknown-language samples use
conservative script/word detection (English, Spanish, French, German, Japanese,
Korean, Arabic, Hindi, Chinese); short/ambiguous samples remain `und`. Explicit
language tags override detection. This heuristic is not a multilingual accuracy
guarantee; ingestion may supply a confirmed language.

For alignment, speakers, hints, and translated variants, pass
`--subtitle-enrichment ./subtitle-jobs.json`. The JSON is an array with one job per
subtitle track, ordered by extracted tracks followed by external `--subtitle` tracks.
Each job accepts `anchors: [{source, target}]` in seconds, `speakers: [{id, name}]`,
`transcript: [{start, end, speakerId}]` in video time, optional `hints` keyed by
zero-based cue index, and `variants: [{language, kind, cues: [{text, hint?}]}]`.
Variant kinds are literal/natural and cue counts must match the original. Empty jobs
produce only an original track. Example for a source with two cues:

```json
[
  {
    "anchors": [{ "source": 0, "target": 0.2 }],
    "speakers": [{ "id": "speaker-1", "name": "Narrator" }],
    "transcript": [{ "start": 0, "end": 12, "speakerId": "speaker-1" }],
    "hints": { "0": "A greeting." },
    "variants": [
      {
        "language": "fr",
        "kind": "literal",
        "cues": [{ "text": "Bonjour." }, { "text": "Bienvenue." }]
      },
      {
        "language": "fr",
        "kind": "natural",
        "cues": [{ "text": "Salut !" }, { "text": "Bienvenue à vous." }]
      }
    ]
  }
]
```

Programmatic ingestion can instead call `enrichSubtitleTrack` with an injected offline
translator. Missing translations fail explicitly; originals are never relabeled as
translations. No AI SDK is added to the media pipeline. One anchor corrects offset;
multiple anchors fit linear drift, rejecting non-monotonic clocks, implausible scale,
residuals over 500ms, or corrected cues outside the video. Overlapping dialogue is
valid. Speakers are matched by greatest temporal overlap. Each variant is a separate
create-once WebVTT track, packaged with its own playlist, metadata flags, and MEDIA row.
Speaker/hint metadata uses a validated `zivora:` cue identifier, which native WebVTT
ignores visually. See the [WebVTT format](https://developer.mozilla.org/en-US/docs/Web/API/WebVTT_API/Web_Video_Text_Tracks_Format).

The player uses a custom DOM renderer for selected cues, with language, translation
style, speaker/hint toggles, size, and top/bottom placement. Preferences are local to
each authenticated UUID returned by the catalog API; guest settings have a separate
key. They are not synchronized across devices. `SELECT_SUBTITLE` accepts an optional
`kind`; all selection still uses the validated controller command path. The adapter
uses Shaka's [text-displayer interface](https://shaka-project.github.io/shaka-player/docs/api/shaka.extern.TextDisplayer.html)
and keeps native captions available. Renderer failure or PiP selects native presentation
without interrupting playback. There is no playback-time translation request.

## Local-first playback persistence (Step 10)

See [Step 10 verification](tests/integration/PLAYER_PERSISTENCE_QA.md) for test evidence,
reproduction commands, and release boundaries.

Apply `database/migrations/004_playback.sql` after 001–003. Its source layers are
`database/{schema,indexes,functions,policies}/004_playback.sql`; regenerate with
`npm run db:migration:build`. The five PLAYBACK tables enable RLS with both `USING`
and `WITH CHECK` against `auth.uid()`. These owner-scoped writes do not change the
service-only CATALOG/MEDIA grants. The `upsert_progress` RPC derives its owner from
the caller, atomically updates progress/history/session, and merges furthest position
with `greatest`. A trigger also guards direct progress updates. Current position uses
the latest `updated_at`; equal timestamps retain the existing position. Future
timestamps beyond five minutes, non-finite/out-of-range positions, and reassignment
of progress/bookmark/session identity are rejected. User progress deletion is not
granted, so deleting a checkpoint cannot reset its high-water mark.

The player checkpoints every five seconds during active playback and on pause, seek, ended, pagehide,
visibility change, navigation, and disposal. It writes a synchronous per-user local
journal first, then an IndexedDB checkpoint/outbox transaction using `idb`, then an
authenticated request. This keeps unload independent of asynchronous network or
IndexedDB completion. Current-item journals are reconciled on the next visit; already
committed IndexedDB outbox entries replay on the next player session. Guest data is
local-only and is never automatically uploaded into a signed-in account.

`ProgressSync` coalesces updates per target, debounces normal writes by 750ms, and
flushes after forced checkpoints or an `online` event. Failed sends use exponential
backoff from one second to a 60-second cap. A stale response cannot acknowledge a
newer pending checkpoint; a newer rewind cannot reduce furthest position. Resume
reconciliation runs alongside authorization with a 400ms budget for the prompt;
a late remote result updates persistence but never seeks or pauses running playback.
The existing cancellable auto-next countdown checkpoints the outgoing episode before
navigating. `HistoryManager` keeps the latest 1,000 local entries, with monotonic
completion flags; the RPC maintains server history and session records.

Player settings now include named bookmarks with keyboard-accessible add, jump, and
remove actions. Jump is a validated controller seek. Bookmarks appear on the timeline
immediately. Their local journal includes a retry queue; deletions are tombstones so
offline removals can reconcile. Storage failures fall back to memory and are reported
through `PlaybackHealth`; memory-only data cannot survive a tab being discarded.
Consumers can observe the payload-free health channel through `onPersistenceHealth`
on `ZivoraPlayer`. Health observer failures are isolated from playback. No tokens,
privileged media URLs, or raw exceptions are put into the persistence journal or health
events.

`GET /api/progress` and `GET /api/bookmarks` accept `contentId` plus optional
`episodeId`. `POST /api/progress` accepts the `ProgressRecordSchema` contract;
`POST /api/bookmarks` accepts `BookmarkSchema`, including `deleted` for removals.
Both routes validate bounded JSON with Zod, authenticate cookies or a bearer token,
reject cross-origin mutations and owner spoofing, and return private/no-store
authoritative records. The Supabase client carries the same caller token used for
authentication; these endpoints never mutate via a service key. Progress is not an
entitlement or media authorization grant.

Added dependencies: [idb 8.0.3](https://github.com/jakearchibald/idb) (ISC) and the
test-only [fake-indexeddb 6.2.5](https://github.com/dumbmatter/fakeIndexedDB)
(Apache-2.0), pinned in the lockfile. `idb` remains behind `services/sync`.
The dependency audit reported seven findings in existing Next/PostCSS and
Vitest/Vite tooling paths, including a critical Vitest UI-server advisory; neither
new package was listed. No force-fix or stack upgrade was applied. Do not expose
development/test servers to untrusted networks; dependency remediation requires a
separate compatibility review within the frozen stack.

## Provider-neutral AI gateway (Step 15)

`AIGateway` is the only public runtime entry point for generation, embeddings,
transcription, and vision. Each request is validated, routed by task type and maximum
cost tier, bounded by a timeout, retried on the selected provider, and then moved down
the configured fallback chain. OpenAI supplies generation, 1536-dimension embeddings,
diarized transcription, and vision; Anthropic supplies the second generation route.
`MockProvider` supplies deterministic tests without network access. Provider HTTP
contracts remain as thin, Zod-validated wrappers in `lib/ai`; orchestration and provider
selection remain in `features/ai/gateway`.

Create the runtime gateway with `createAIGateway(environment, usageRepository)`. The
default route uses OpenAI for `cheap_chat`, `embedding`, `transcription`, and `vision`,
and prefers Anthropic with OpenAI fallback for `complex_reasoning` when an Anthropic
key is configured. `OPENAI_API_KEY` is required when constructing the gateway;
`ANTHROPIC_API_KEY` and all model/base-URL overrides are optional. Provider credentials
remain server- and ingestion-only.

Apply `database/migrations/007_ai.sql` after migration 006. Its ordered source layers
are `database/{schema,indexes,functions,policies}/007_ai.sql`; regenerate with
`npm run db:migration:build`. The migration creates only the five frozen AI tables.
Conversation, message, preference, and usage reads are owner-scoped; cache access and
usage writes are service-role only. Every gateway request attempts one `ai_usage` write
containing route, model, attempts, latency, success, token counts, and estimated cost.
Accounting failures are intentionally isolated from the AI result.

## Spoiler-safe retrieval and orchestration (Steps 16–17)

Apply `database/migrations/008_ai_retrieval.sql` after 001–007. Regenerate migrations
with `npm run db:migration:build`, or `node --import tsx database/migrations/build.ts`
on hosts that disallow the tsx CLI's local IPC socket. The migration adds functions,
indexes, and a result composite type; it creates no tables.

`WatchBoundary` uses current episode/position in `strict_current` mode and the
furthest episode/position in `watched_knowledge` mode. Episode order is zero-based
across the entire content, sorted by season number, episode order_index, then UUID;
unpublished episodes retain their ordinal. Movies use order zero. The API checks the
current ordinal against the active catalog and derives furthest knowledge from the
authenticated user's stored progress plus their current position.

`search_scenes` and `search_transcript` accept `query_embedding` (1536 dimensions,
nullable for keyword-only search), `query_text`, `content_id`,
`boundary_episode_order`, `boundary_seconds`, `filters`, and `limit` (1–30).
The SQL WHERE clause admits an earlier episode or an interval whose **end** is at or
before the boundary in the same episode. A segment starting before the boundary but
ending after it is excluded. Only active READY media under READY content is eligible.
Chapter titles and character appearance IDs are also bounded; global character
biographies are never retrieved. Filters support episode, character, chapter,
language, embedding model, and an authorized list of media version IDs.

SQL fuses cosine and full-text ranks using reciprocal rank fusion with k=60, following
the [Supabase hybrid search pattern](https://supabase.com/docs/guides/ai/hybrid-search).
The filtered candidate relation is materialized before ranking to make the boundary
explicit; benchmark query latency on a production-sized catalog before tuning indexes.
`RankingService` applies bounded character/chapter boosts. Confidence combines the
unboosted fused score and runner-up margin, capped by the generated confidence. This
is a conservative decision heuristic, not a calibrated probability of correctness.

Both `POST /api/ai/ask` and `POST /api/ai/command` accept the same body:

```json
{
  "contentId": "11111111-1111-4111-8111-111111111111",
  "episodeId": null,
  "question": "Find the lighthouse scene",
  "watchState": {
    "currentEpisodeOrder": 0,
    "currentPosition": 120,
    "furthestEpisodeOrder": 0,
    "furthestPosition": 180
  },
  "mode": "strict_current",
  "language": "en",
  "conversationId": null
}
```

Use a Supabase session cookie or bearer token. Requests require content entitlement
for private content, honor AI preferences, reject cross-origin requests and bodies
over 16 KiB, and reserve a shared database rate slot (20 requests/user/minute).
Rate reservations use zero-cost `ai_usage` rows with provider `rate-limit`; they are
separate from actual model usage. Search RPCs remain service-role only. Responses are
private/no-store, and the entire route has a 25-second deadline.

The orchestrator routes all nine intents, retrieves safe evidence, builds bounded
context, validates generated JSON, and checks each timestamp against its evidence.
Unsupported questions return confidence zero. Stored conversations are not fed back
into the model, so an earlier conversation cannot reveal later-watched material after
a rewind. Answers contain `answer`, `confidence`, `candidates`, `conversationId`,
`intent`, `boundary`, and optionally `command`. Each candidate also includes
`evidenceId` and `episodeId` to distinguish identical timestamps across episodes.

Grounded answers produce one AI `SEEK_TO` only with one candidate at confidence

> = 0.8 in the current episode.
> Ambiguous or cross-episode results remain candidates with no command. Explicit
> play, pause, mute, volume, speed, fullscreen, and PiP controls use a deterministic
> allowlist; arbitrary model-proposed commands are discarded. Hand an accepted command
> to `dispatchAICommand(command, controller)`; the controller's existing validator
> rechecks live duration and session rate limits before PlayerEngine executes it.

The cache key includes the requested 30-second position and spoiler buckets,
normalized question, intent, language, content, and episode, plus the exact boundary,
user, mode, filters, active media versions, model, and policy version. Exact boundary
scoping prevents later answers leaking within the same bucket. Entries expire after
five minutes; cached commands are never replayed. Cache operations have a 500ms
budget and failures become misses. Conversation/message writes are atomic through
`append_ai_exchange`, owner-scoped, and respect the user's history opt-out.

Run focused verification with `npm test -- tests/ai tests/spoiler-guard`. SQL tests
use pinned `@electric-sql/pglite-pgvector@0.0.9` with the existing PGlite 0.5.8 to
execute actual PostgreSQL/vector retrieval, RLS, boundary, persistence, and rate-limit
checks without cloud credentials. The tests do not call live model providers.

## Frozen v1.0 release hardening

The architectural contract in `AGENTS.md` is frozen: PlayerEngine owns playback,
Shaka stays behind the adapter, every action reaches playback through validated
PlayerCommands and PlayerController, media bytes travel directly from immutable R2
versions, spoiler boundaries are enforced in SQL, and AI/sync/analytics failures never
interrupt playback. Do not weaken these boundaries to resolve a deployment issue.

The installable PWA caches only the anonymous application shell and same-origin
`/_next/static` assets. The service worker explicitly bypasses `/api`, `/watch`, remote
origins, media request destinations, manifests, segments, audio, subtitles, and video.
Shaka, Ask Zivora, and the precision timeline are lazy chunks. After a production build,
audit initial JavaScript and heavy-module isolation with:

```bash
npm run build
npm run bundle:audit
```

The frozen ingest lifecycle is:

`PROBE -> VALIDATE -> TRANSCODE -> PACKAGE -> THUMBNAILS -> SUBTITLES -> TRANSCRIBE -> SCENES -> CHARACTERS -> EMBEDDINGS -> CHAPTERS -> RECAPS -> SKIP MARKERS -> UPLOAD NEW MEDIA VERSION -> VALIDATE CLOUD MEDIA -> TEST PLAYBACK -> REGISTER DATABASE -> ATOMIC PUBLISH -> READY`.

Failures mark the candidate `FAILED` and leave the active media pointer untouched.
Resume with `--from`, omit optional intelligence with `--skip-ai`, inspect without writes
with `--dry-run`, and move the active pointer back with `--rollback`.

Before release, run the full verification block at the top of this README and follow
[`docs/DEPLOYMENT_CHECKLIST.md`](docs/DEPLOYMENT_CHECKLIST.md). The checklist covers
Vercel secrets and rollback, executable Supabase RLS checks, R2 CORS/cache metadata,
immutable prefixes, browser smoke tests, bundle evidence, and post-deploy telemetry.
