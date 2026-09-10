# Player UI delivery brief — Step 7

## Local-first playback state — Step 10

The viewer must keep their place and saved moments when the network fails. Timing
checkpoints go synchronously to a per-user local journal, then into an IndexedDB
checkpoint/outbox transaction, then to an authenticated RPC. The latest timestamp
owns current position; furthest position only increases. A late restore never seeks
or pauses a playing video. Guest records do not upload or migrate into signed-in users.

Saved moments extend the existing settings panel with a named input, add, jump, and
remove actions. Jump uses PlayerController; saving/removing are validated persistence
actions, not video commands. Amber timeline markers reflect local bookmarks immediately.
The existing resume dialog and cancellable auto-next countdown keep their focus and
navigation behavior; outgoing progress is checkpointed before episode navigation.
Offline failures use a separate payload-free health channel. Acceptance includes
offline reload/replay, two-user isolation, stale acknowledgements, monotonic SQL,
keyboard bookmark interaction, and real playback continuing during sync failure.

## Outcome and constraints

Viewers need to watch a title, adjust playback, recover interruptions, and continue episodes on desktop and touch devices. Success means visible state follows the engine and playback actions enter PlayerController. The frozen architecture and installed stack remain unchanged. AI panels, recommendations, remote sync and publishing are outside this slice.

## Journey and state

The watch route selects READY metadata. The browser gets a grant from `/api/playback`; the adapter downloads media directly from R2. A per-player context owns the controller and store. Snapshots, tracks, qualities and buffer health are read-only projections. Controls, menus, focus, notices and prompts are view state. Episode selection belongs in the URL. Validated local progress is durable browser state; blocked storage falls back to memory. Autoplay rejection leaves a usable Play button. Fatal errors allow retry at the last position; ended episodes offer a cancellable countdown.

## Experience direction

A cinema-first black canvas with quiet, legible controls: near-black surfaces, white text, slate secondary labels, violet progress/focus accents and amber warnings. System sans-serif and tabular timing. The signature is a thin violet timeline with subtle buffered coverage. Controls have 44px touch targets, mobile wrapping and visible keyboard focus. Transitions respect reduced motion. No fabricated video artwork or title metadata.

## Components and evidence

VideoSurface owns only the video element; PlayerOverlay composes controls and state overlays. Native ranges/selects support keyboard seeking and settings. Tap, double-tap, temporary 2× and vertical swipe gestures all have button alternatives. Modal prompts manage focus. Focused controls never auto-hide. Native caption cues have high contrast and a larger-text option.

Vitest covers store projection, gesture timing/cancellation, progress, commands, recovery and cleanup. Playwright covers watch journeys and phone/desktop layouts with controlled media/API fixtures. Live R2, entitlement configuration and device-specific DRM/fullscreen/PiP are environment-dependent checks. Test doubles must not be available as a production playback mode.

## Precision timeline and subtitles — Steps 8–9

The extended job is finding an exact moment in content as long as 24 hours without
triggering intermediate seeks, then understanding the current dialogue with already
ingested subtitle variants. Zoom is local view state; positions remain engine state.
Chapter, scene, bookmark, skip-region, and sprite metadata are validated inputs, not
fabricated catalog data. Canvas draws dense markers; bounded DOM labels carry titles.
The violet timeline remains the signature element, with amber bookmarks and distinct
skip-region colors plus textual descriptions. Pointer release commits through the
controller; cancellation preserves playback position. Keyboard controls are equivalent.

Subtitle language/style is command state. Speaker names, hints, size, and placement
are presentation preferences persisted locally under the authenticated user UUID (or
an isolated guest key). No token, URL, or transcript is persisted with preferences.
The adapter owns the text-displayer bridge and native fallback; React sees only
neutral active cues. A renderer error must never seek, pause, reload, or fail video.
Translated text and optional hints come from ingestion, never playback-time AI.

Acceptance includes 24-hour coordinate round trips, pointer-centered zoom, release-only
seek, two-pointer pinch, cancellation/cleanup, dense marker bounds, VTT parsing and
drift correction, user preference isolation, actual decoded browser playback with
custom captions, and native fallback after a malformed renderer payload.
