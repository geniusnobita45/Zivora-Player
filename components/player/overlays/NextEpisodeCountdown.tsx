"use client";
import { useEffect, useState } from "react";
import { usePlayer } from "../PlayerContext";
export function NextEpisodeCountdown() {
  const { next, playNext } = usePlayer();
  const [seconds, setSeconds] = useState(10);
  const [cancelled, setCancelled] = useState(false);
  useEffect(() => {
    if (cancelled) return;
    const timer = setInterval(() => {
      if (document.visibilityState !== "hidden") setSeconds((value) => Math.max(0, value - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [cancelled]);
  useEffect(() => {
    if (!cancelled && seconds === 0) playNext();
  }, [cancelled, seconds, playNext]);
  if (!next) return null;
  return (
    <div className="zivora-up-next" role="region" aria-label="Up next">
      <p className="zivora-eyebrow">UP NEXT</p>
      <h2>{next.description || next.title}</h2>
      <p>{cancelled ? "Autoplay cancelled" : `Next episode in ${seconds} seconds`}</p>
      <div className="zivora-dialog-actions">
        <button className="zivora-primary" onClick={playNext}>
          Play next episode
        </button>
        {!cancelled && (
          <button className="zivora-secondary" onClick={() => setCancelled(true)}>
            Cancel countdown
          </button>
        )}
      </div>
    </div>
  );
}
