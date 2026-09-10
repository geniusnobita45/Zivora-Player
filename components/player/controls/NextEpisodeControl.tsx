"use client";
import { usePlayer } from "../PlayerContext";
import { ControlButton } from "./ControlButton";
export function NextEpisodeControl() {
  const { next, playNext } = usePlayer();
  return next ? (
    <ControlButton label="Next episode" icon="next" onClick={playNext}>
      <span className="zivora-next-label">Next episode</span>
    </ControlButton>
  ) : null;
}
