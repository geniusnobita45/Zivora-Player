"use client";
import { usePlayer, usePlayerStore } from "../PlayerContext";
import { ControlButton } from "./ControlButton";
export function PresentationControls() {
  const { perform } = usePlayer();
  const fullscreen = usePlayerStore((s) => s.ui.fullscreen);
  const pip = usePlayerStore((s) => s.ui.pip);
  return (
    <>
      <ControlButton
        label={pip ? "Exit picture-in-picture" : "Picture-in-picture"}
        icon="pip"
        pressed={pip}
        onClick={() => perform((c) => c.togglePictureInPicture())}
      />
      <ControlButton
        label={fullscreen ? "Exit fullscreen" : "Fullscreen"}
        icon="fullscreen"
        pressed={fullscreen}
        onClick={() => perform((c) => c.toggleFullscreen())}
      />
    </>
  );
}
