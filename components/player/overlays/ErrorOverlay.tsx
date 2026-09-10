"use client";
import { usePlayer, usePlayerStore } from "../PlayerContext";
import { FocusDialog } from "../accessibility/FocusDialog";
import { formatTime } from "../timeline/time";
export function ErrorOverlay() {
  const { retry } = usePlayer();
  const position = usePlayerStore((s) => s.snapshot?.position ?? 0);
  const error = usePlayerStore((s) => s.ui.loadError);
  return (
    <FocusDialog title="Let’s get you watching again">
      <p>{error ?? "Playback was interrupted. Your position is saved on this device."}</p>
      <p className="zivora-muted">Retry from {formatTime(position)}</p>
      <button className="zivora-primary" onClick={retry}>
        Retry playback
      </button>
    </FocusDialog>
  );
}
