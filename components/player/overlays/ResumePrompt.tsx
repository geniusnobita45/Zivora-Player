"use client";
import { usePlayer } from "../PlayerContext";
import { FocusDialog } from "../accessibility/FocusDialog";
import { formatTime } from "../timeline/time";
export function ResumePrompt({ position }: { position: number }) {
  const { resume } = usePlayer();
  return (
    <FocusDialog title="Pick up where you left off" onDismiss={() => resume(0)}>
      <p>Your saved position is {formatTime(position)}.</p>
      <div className="zivora-dialog-actions">
        <button className="zivora-primary" onClick={() => resume(position)}>
          Resume at {formatTime(position)}
        </button>
        <button className="zivora-secondary" onClick={() => resume(0)}>
          Start from beginning
        </button>
      </div>
    </FocusDialog>
  );
}
