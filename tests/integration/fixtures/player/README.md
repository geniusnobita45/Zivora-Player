# Real playback fixture

This generated test pattern and 220 Hz tone are original test assets, not catalog content.
The 32-second fixture contains two H.264 renditions, two-second aligned keyframes,
four-second fMP4 HLS segments, one AAC audio track, and WebVTT captions.

The subtitle fixtures include original English and explicitly authored synthetic
French literal/natural variants. A `zivora:` identifier carries a speaker and context
hint for renderer tests. The small two-cell SVG is an authored sprite-cropping fixture;
production ingestion still emits JPEG sprites. These are test assets, not real
translations or catalog intelligence. The FFmpeg script only regenerates audio/video;
the checked-in playlists, SVG, and WebVTT files are maintained separately.

Playwright serves these checked-in assets from a mocked external media origin and
stubs catalog/authorization and owner-scoped progress/bookmark JSON. The production Shaka adapter and media element
remain real. Tests do not encode or contact Supabase/R2. Cloud access, CORS, signing
and real-device compatibility require separate deployment verification.

To generate assets in a fresh copy of this directory: `bash generate.sh` with FFmpeg
on PATH, or set `FFMPEG_BIN` to its absolute path. Existing outputs are not overwritten.
