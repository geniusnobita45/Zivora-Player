"use client";
import { useEffect, useMemo } from "react";
import type { PointerEvent } from "react";
import { usePlayer } from "../PlayerContext";
import { updatePlayerUI, revealControls } from "@/stores/player.store";
import { GestureRecognizer } from "./GestureRecognizer";
export function GestureSurface() {
  const { controller, store, perform } = usePlayer();
  const recognizer = useMemo(
    () =>
      new GestureRecognizer({
        snapshot: () => ({
          rate: controller?.getSnapshot().rate ?? 1,
          volume: controller?.getSnapshot().volume ?? 1,
        }),
        tap: () => {
          const { ui, snapshot } = store.getState();
          if (snapshot?.paused || ui.menu) revealControls(store);
          else
            updatePlayerUI(store, {
              controlsVisible: !ui.controlsVisible,
              activity: ui.activity + 1,
            });
        },
        seek: (delta) => perform((c) => c.seekBy(delta, { source: "gesture" })),
        rate: (rate) => perform((c) => c.setPlaybackRate(rate, { source: "gesture" })),
        volume: (level) => perform((c) => c.setVolume(level, { source: "gesture" })),
        feedback: (gesture) => updatePlayerUI(store, { gesture }),
      }),
    [controller, store, perform],
  );
  useEffect(() => {
    const cancel = () => recognizer.cancel();
    window.addEventListener("blur", cancel);
    document.addEventListener("visibilitychange", cancel);
    return () => {
      cancel();
      window.removeEventListener("blur", cancel);
      document.removeEventListener("visibilitychange", cancel);
    };
  }, [recognizer]);
  const pointer = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      id: event.pointerId,
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
      width: rect.width,
      height: rect.height,
    };
  };
  return (
    <div
      className="zivora-gesture-surface"
      data-testid="gesture-surface"
      aria-hidden="true"
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.currentTarget.setPointerCapture?.(event.pointerId);
        recognizer.down(pointer(event));
      }}
      onPointerMove={(event) => recognizer.move(pointer(event))}
      onPointerUp={(event) => recognizer.up(pointer(event))}
      onPointerCancel={() => recognizer.cancel()}
      onLostPointerCapture={(event) => recognizer.lostCapture(event.pointerId)}
      onContextMenu={(event) => event.preventDefault()}
    />
  );
}
