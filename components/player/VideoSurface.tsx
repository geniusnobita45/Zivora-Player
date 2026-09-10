"use client";
import { useEffect } from "react";
import { usePlayerStore } from "./PlayerContext";
import { observeCaptionPlacement } from "./subtitles/CaptionPlacement";
export function VideoSurface({ videoRef }: { videoRef: React.RefObject<HTMLVideoElement | null> }) {
  const visible = usePlayerStore(
    (state) => state.ui.controlsVisible || (state.snapshot?.paused ?? true),
  );
  useEffect(() => {
    if (videoRef.current) return observeCaptionPlacement(videoRef.current, visible);
  }, [videoRef, visible]);
  return (
    <video
      ref={videoRef}
      className="zivora-video"
      playsInline
      controls={false}
      preload="metadata"
      tabIndex={-1}
      aria-label="Video presentation"
    >
      Your browser does not support HTML video.
    </video>
  );
}
