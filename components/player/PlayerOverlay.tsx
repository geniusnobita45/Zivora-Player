"use client";
import { useEffect, useId, useRef } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { canHideControls, updatePlayerUI } from "@/stores/player.store";
import { useDegradation, useDegradationManager, usePlayer, usePlayerStore } from "./PlayerContext";
import { GestureSurface } from "./gestures/GestureSurface";
import { PlayControl } from "./controls/PlayControl";
import { TimeDisplay } from "./controls/TimeDisplay";
import { VolumeControl } from "./controls/VolumeControl";
import { QualityMenu } from "./controls/QualityMenu";
import { AudioMenu } from "./controls/AudioMenu";
import { SubtitleMenu } from "./controls/SubtitleMenu";
import { SubtitleSettings } from "./subtitles/SubtitleSettings";
import { RateMenu } from "./controls/RateMenu";
import { PresentationControls } from "./controls/PresentationControls";
import { NextEpisodeControl } from "./controls/NextEpisodeControl";
import { ControlButton, Icon } from "./controls/ControlButton";
import { LoadingOverlay } from "./overlays/LoadingOverlay";
import { ErrorOverlay } from "./overlays/ErrorOverlay";
import { ResumePrompt } from "./overlays/ResumePrompt";
import { NextEpisodeCountdown } from "./overlays/NextEpisodeCountdown";
import { BookmarkControls } from "./controls/BookmarkControls";
import { DegradationIndicator } from "./DegradationIndicator";
import { BasicSeekBar } from "./controls/BasicSeekBar";
import { OptionalFeatureBoundary } from "@/components/shared/OptionalFeatureBoundary";
import { SkipSegmentControl } from "@/components/ai/Commands/SkipSegmentControl";
const SeekBar = dynamic(() => import("./timeline/Timeline").then((module) => module.Timeline), {
  loading: () => <BasicSeekBar />,
  ssr: false,
});

export function PlayerOverlay() {
  const { store, item, next, perform, subtitleStore } = usePlayer();
  const degradationManager = useDegradationManager();
  const degradation = useDegradation();
  const ui = usePlayerStore((s) => s.ui);
  const state = usePlayerStore((s) => s.snapshot?.state ?? "idle");
  const paused = usePlayerStore((s) => s.snapshot?.paused ?? true);
  const settingsId = useId();
  const settingsButton = useRef<HTMLButtonElement>(null);
  const fatal = state === "error" || ui.phase === "failed";
  const modal = fatal || ui.resumePosition !== null;
  const busy = !fatal && (ui.phase !== "ready" || state === "loading" || state === "buffering");
  const visible = ui.controlsVisible || paused || modal;
  useEffect(() => {
    if (!canHideControls(store.getState())) return;
    const timer = setTimeout(() => {
      if (canHideControls(store.getState())) updatePlayerUI(store, { controlsVisible: false });
    }, 3000);
    return () => clearTimeout(timer);
  }, [
    store,
    ui.activity,
    ui.focused,
    ui.menu,
    ui.phase,
    ui.resumePosition,
    ui.loadError,
    state,
    paused,
  ]);
  useEffect(() => {
    if (!ui.notice) return;
    const timer = setTimeout(() => updatePlayerUI(store, { notice: null }), 6000);
    return () => clearTimeout(timer);
  }, [store, ui.notice]);
  return (
    <>
      <div
        className="zivora-interaction-layer"
        inert={modal || ui.phase !== "ready"}
        aria-hidden={modal || undefined}
      >
        <GestureSurface />
      </div>
      <div
        className="zivora-chrome"
        data-visible={visible}
        inert={!visible || modal}
        aria-hidden={!visible || modal || undefined}
      >
        <SkipSegmentControl />
        <header className="zivora-player-header">
          <Link href="/" className="zivora-control" aria-label="Back to Zivora">
            <Icon name="back" />
          </Link>
          <div>
            <p className="zivora-eyebrow">ZIVORA · NOW PLAYING</p>
            <h1>{item.title}</h1>
            {item.description && <p className="zivora-muted">{item.description}</p>}
          </div>
        </header>
        <fieldset
          className="zivora-controls"
          disabled={ui.phase !== "ready" || fatal || ui.resumePosition !== null}
        >
          <legend className="sr-only">Playback controls</legend>
          {ui.menu === "settings" && (
            <div
              id={settingsId}
              className="zivora-settings"
              role="group"
              aria-label="Player settings"
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.stopPropagation();
                  updatePlayerUI(store, { menu: null });
                  settingsButton.current?.focus();
                }
              }}
            >
              <div className="zivora-settings-heading">
                <h2>Playback settings</h2>
                <ControlButton
                  label="Close settings"
                  icon="close"
                  onClick={() => {
                    updatePlayerUI(store, { menu: null });
                    settingsButton.current?.focus();
                  }}
                />
              </div>
              <QualityMenu />
              <AudioMenu />
              {degradation.level < 3 && subtitleStore ? (
                <SubtitleSettings subtitleStore={subtitleStore} />
              ) : degradation.level < 3 ? (
                <SubtitleMenu />
              ) : null}
              <RateMenu />
              <BookmarkControls />
              <div className="zivora-settings-volume">
                <VolumeControl />
              </div>
              {!subtitleStore && (
                <label>
                  Caption size
                  <select
                    value={ui.captionSize}
                    onChange={(event) =>
                      updatePlayerUI(store, {
                        captionSize: event.currentTarget.value === "large" ? "large" : "normal",
                      })
                    }
                  >
                    <option value="normal">Standard</option>
                    <option value="large">Large</option>
                  </select>
                </label>
              )}
            </div>
          )}
          <OptionalFeatureBoundary
            capability="chapters"
            manager={degradationManager}
            fallback={<BasicSeekBar />}
          >
            <SeekBar />
          </OptionalFeatureBoundary>
          <div className="zivora-control-row">
            <PlayControl />
            <ControlButton
              label="Back 10 seconds"
              icon="rewind"
              onClick={() => perform((c) => c.seekBy(-10))}
            />
            <ControlButton
              label="Forward 10 seconds"
              icon="forward"
              onClick={() => perform((c) => c.seekBy(10))}
            />
            <TimeDisplay />
            <span className="zivora-spacer" />
            <NextEpisodeControl />
            <button
              ref={settingsButton}
              className="zivora-control"
              aria-label="Player settings"
              aria-expanded={ui.menu === "settings"}
              aria-controls={ui.menu ? settingsId : undefined}
              onClick={() => updatePlayerUI(store, { menu: ui.menu ? null : "settings" })}
            >
              <Icon name="settings" />
            </button>
            <PresentationControls />
          </div>
          <div className="zivora-secondary-row">
            <VolumeControl />
            <span className="zivora-shortcuts">Space to play · ← → to seek · F for fullscreen</span>
          </div>
        </fieldset>
      </div>
      {busy && <LoadingOverlay authorizing={ui.phase === "authorizing"} />}
      {fatal && <ErrorOverlay />}
      {!fatal && ui.resumePosition !== null && <ResumePrompt position={ui.resumePosition} />}
      {!modal && state === "ended" && next && <NextEpisodeCountdown />}
      <DegradationIndicator />
      <div className="zivora-feedback" role="status" aria-live="polite">
        {ui.gesture || ui.notice}
      </div>
    </>
  );
}
