#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
encoder="${FFMPEG_BIN:-ffmpeg}"
for size in 320x180 640x360; do
  mkdir -p "$size"
  "$encoder" -hide_banner -loglevel error -n -f lavfi -i "testsrc2=size=$size:rate=24" \
    -t 32 -an -c:v libx264 -preset veryfast -crf 35 -profile:v baseline -level 3.0 \
    -pix_fmt yuv420p -g 48 -keyint_min 48 -sc_threshold 0 \
    -f hls -hls_time 4 -hls_playlist_type vod -hls_flags independent_segments \
    -hls_segment_type fmp4 -hls_fmp4_init_filename init.mp4 \
    -hls_segment_filename "$size/segment-%02d.m4s" "$size/index.m3u8"
done
mkdir -p audio
"$encoder" -hide_banner -loglevel error -n -f lavfi -i 'sine=frequency=220:sample_rate=48000' \
  -t 32 -vn -c:a aac -b:a 48k -metadata:s:a:0 language=eng \
  -f hls -hls_time 4 -hls_playlist_type vod -hls_segment_type fmp4 \
  -hls_fmp4_init_filename init.mp4 -hls_segment_filename 'audio/segment-%02d.m4s' audio/index.m3u8
