"use client";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { z } from "zod";
import { useStore } from "zustand";
import dynamic from "next/dynamic";
import "./player.css";
import "./accessibility/captions.css";
import "./timeline/timeline.css";
import "./subtitles/subtitles.css";
import { EMPTY_TIMELINE, TimelineDataSchema } from "@/types/timeline";
import { createSubtitleStore } from "@/stores/subtitle.store";
import { SubtitleRenderer } from "./subtitles/SubtitleRenderer";
import { PlayerController } from "@/core/player/PlayerController";
import type { DispatchResult } from "@/core/player/PlayerController";
import {
  createPlayerStore,
  connectPlayerStore,
  revealControls,
  updatePlayerUI,
} from "@/stores/player.store";
import { WatchItemSchema, type WatchItem } from "@/types/watch";
import { attachPlaybackTelemetry } from "@/services/telemetry/PlaybackSession";
import { PlayerSession, type PlaybackTransport } from "./PlayerSession";
import { PlayerContext } from "./PlayerContext";
import { PlayerOverlay } from "./PlayerOverlay";
import { ProgressManager } from "@/core/playback/ProgressManager";
import { BookmarkManager, type LocalStoragePort } from "@/core/playback/BookmarkManager";
import { HistoryManager } from "@/core/playback/HistoryManager";
import { PlaybackHealth, type PlaybackHealthEvent } from "@/core/playback/PlaybackHealth";
import { OfflineProgress } from "@/services/sync/OfflineProgress";
import { ProgressSync } from "@/services/sync/ProgressSync";
import { bookmarkTransport } from "@/features/bookmarks/transport";
import { VideoSurface } from "./VideoSurface";
import { DegradationManager } from "@/services/degradation/DegradationManager";
import { OptionalFeatureBoundary } from "@/components/shared/OptionalFeatureBoundary";
const ZivoraAI = dynamic(
  () => import("@/components/ai/ZivoraAI").then((module) => module.ZivoraAI),
  { ssr: false },
);

export type ControllerFactory = typeof PlayerController.forVideo;
export interface ZivoraPlayerProps {
  timeline?: unknown;
  userId?: string | null;
  item: WatchItem;
  next?: WatchItem | null;
  onNext?: (item: WatchItem) => void;
  transport?: PlaybackTransport;
  createController?: ControllerFactory;
  onPersistenceHealth?: (event: PlaybackHealthEvent) => void;
}
export function ZivoraPlayer({
  item: input,
  next = null,
  onNext,
  transport,
  createController = PlayerController.forVideo,
  timeline: timelineInput = EMPTY_TIMELINE,
  userId = null,
  onPersistenceHealth,
}: ZivoraPlayerProps) {
  const [degradation] = useState(() => new DegradationManager());
  const degradationState = useSyncExternalStore(
    degradation.subscribe,
    degradation.getSnapshot,
    degradation.getSnapshot,
  );
  const healthObserver = useRef(onPersistenceHealth);
  healthObserver.current = onPersistenceHealth;
  const parsedTimeline = useMemo(
    () => TimelineDataSchema.safeParse(timelineInput),
    [timelineInput],
  );
  const timeline = parsedTimeline.success ? parsedTimeline.data : EMPTY_TIMELINE;
  useEffect(() => {
    if (parsedTimeline.success) {
      degradation.reportHealthy("chapters");
      degradation.reportHealthy("thumbnails");
      return;
    }
    const retry = () => timelineInput;
    degradation.reportUnavailable("chapters", retry, TimelineDataSchema);
    degradation.reportUnavailable("thumbnails", retry, TimelineDataSchema);
  }, [degradation, parsedTimeline.success, timelineInput]);
  const subtitleStore = useMemo(() => createSubtitleStore(userId), [userId]);
  const subtitleOutput = useRef(subtitleStore.presentation);
  subtitleOutput.current = subtitleStore.presentation;
  const { contentId, episodeId, title, description } = input;
  const item = useMemo(
    () => WatchItemSchema.parse({ contentId, episodeId, title, description }),
    [contentId, episodeId, title, description],
  );
  const [store] = useState(createPlayerStore);
  const captionSize = useStore(store, (state) => state.ui.captionSize);
  const videoRef = useRef<HTMLVideoElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const factory = useRef(createController);
  const transportRef = useRef(transport);
  const lifecycle = useRef<Promise<void>>(Promise.resolve());
  const [runtime, setRuntime] = useState<{
    controller: PlayerController;
    session: PlayerSession;
    bookmarks: BookmarkManager;
  } | null>(null);
  const nextPending = useRef(false);
  useEffect(() => {
    let cancelled = false;
    let release: (() => Promise<void>) | undefined;
    // StrictMode's probe mount is cancelled before allocation; teardown precedes reuse.
    lifecycle.current = lifecycle.current
      .then(() => {
        if (cancelled || !videoRef.current || !rootRef.current) return;
        const controller = factory.current(
          videoRef.current,
          rootRef.current,
          { autoplay: false },
          {
            textPresentation: {
              render: (cues, visible) => subtitleOutput.current.render(cues, visible),
            },
            authorizeRequest: (request) => session.authorizeRequest(request),
          },
        );
        const health = new PlaybackHealth();
        const stopHealth = health.on((event) => {
          try {
            healthObserver.current?.(event);
          } catch {
            // Persistence health observers are optional.
          }
          if (event.component === "sync")
            degradation.reportUnavailable("progressSync", () => {
              if (typeof navigator !== "undefined" && !navigator.onLine) throw new Error("Offline");
              return true;
            });
        });
        let storage: LocalStoragePort | null = null;
        try {
          storage = window.localStorage;
        } catch {
          health.report("progress", "storage");
        }
        const progress = new ProgressManager(storage, userId, health);
        const history = new HistoryManager(userId, storage, health);
        const bookmarks = new BookmarkManager(userId, storage, bookmarkTransport, health);
        let sync: ProgressSync | undefined;
        try {
          sync = new ProgressSync(new OfflineProgress(userId, health));
          degradation.reportHealthy("progressSync");
        } catch {
          health.report("sync", "storage");
        }
        const session = new PlayerSession(
          controller,
          store,
          transportRef.current,
          progress,
          sync ? { userId, sync, history } : undefined,
        );
        const flushBookmarks = () => {
          void bookmarks.flush();
        };
        window.addEventListener("online", flushBookmarks);
        const disconnect = connectPlayerStore(store, controller);
        const save = () => session.save(true);
        const presentation = () =>
          updatePlayerUI(store, {
            fullscreen: document.fullscreenElement === rootRef.current,
            pip: document.pictureInPictureElement === videoRef.current,
          });
        const video = videoRef.current;
        window.addEventListener("pagehide", save);
        document.addEventListener("visibilitychange", save);
        document.addEventListener("fullscreenchange", presentation);
        video.addEventListener("enterpictureinpicture", presentation);
        video.addEventListener("leavepictureinpicture", presentation);
        release = async () => {
          session.dispose();
          sync?.dispose();
          void sync?.local.close();
          bookmarks.dispose();
          stopHealth();
          window.removeEventListener("online", flushBookmarks);
          disconnect();
          window.removeEventListener("pagehide", save);
          document.removeEventListener("visibilitychange", save);
          document.removeEventListener("fullscreenchange", presentation);
          video.removeEventListener("enterpictureinpicture", presentation);
          video.removeEventListener("leavepictureinpicture", presentation);
          await controller.destroy();
        };
        setRuntime({ controller, session, bookmarks });
      })
      .catch(() =>
        updatePlayerUI(store, {
          phase: "failed",
          loadError: "The player could not initialize. Reload this page.",
        }),
      );
    return () => {
      cancelled = true;
      lifecycle.current = lifecycle.current.then(() => release?.()).catch(() => {});
    };
  }, [degradation, store, userId]);
  useEffect(() => {
    if (!runtime) return;
    runtime.controller.setSkipSegments(timeline.skipSegments);
  }, [runtime, timeline.skipSegments]);
  useEffect(() => {
    if (!runtime) return;
    nextPending.current = false;
    void runtime.session.load(item);
    void runtime.bookmarks.refresh(item);
    let stop: (() => void) | undefined;
    if (process.env.NODE_ENV === "production") {
      let active = true;
      const context = {
        sessionId: () => runtime.session.telemetrySessionId(),
        contentId: item.contentId,
        episodeId: item.episodeId,
        userId,
        mediaVersionId: () => runtime.session.telemetryMediaVersionId(),
      };
      try {
        stop = attachPlaybackTelemetry(runtime.controller, context);
        degradation.reportHealthy("analytics");
      } catch {
        degradation.reportUnavailable(
          "analytics",
          () => {
            if (!active) throw new Error("Playback session ended");
            stop = attachPlaybackTelemetry(runtime.controller, context);
            return true;
          },
          z.literal(true),
        );
      }
      return () => {
        active = false;
        degradation.cancelRetry("analytics");
        stop?.();
      };
    }
    return undefined;
  }, [degradation, runtime, item, userId]);
  useEffect(() => {
    if (!runtime) return;
    const apply = () => {
      const preferences = subtitleStore.getState().preferences;
      updatePlayerUI(store, { captionSize: preferences.size });
      void runtime.controller
        .selectSubtitle(
          preferences.language,
          { reason: "Restore user subtitle preferences" },
          preferences.kind,
        )
        .then((result) => {
          if (!result.ok && preferences.language) {
            void runtime.controller.selectSubtitle(null).catch(() => {});
            updatePlayerUI(store, {
              notice: "Your preferred subtitles are unavailable for this title.",
            });
          }
        })
        .catch(() => {});
    };
    const stop = runtime.controller.on("ready", apply);
    if (["ready", "playing", "paused"].includes(runtime.controller.getSnapshot().state)) apply();
    return stop;
  }, [runtime, subtitleStore, store]);
  const perform = useCallback(
    (command: (controller: PlayerController) => Promise<DispatchResult>) => {
      if (!runtime) return;
      revealControls(store);
      try {
        void command(runtime.controller)
          .then((result) => runtime.session.notice(result))
          .catch(() =>
            updatePlayerUI(store, { notice: "The control could not complete. Please try again." }),
          );
      } catch {
        updatePlayerUI(store, { notice: "The control could not complete. Please try again." });
      }
    },
    [runtime, store],
  );
  const value = useMemo(
    () => ({
      controller: runtime?.controller ?? null,
      timeline,
      subtitleStore,
      bookmarks: runtime?.bookmarks,
      degradation,
      store,
      item,
      next,
      perform,
      retry: () => {
        if (runtime) void runtime.session.retry();
      },
      resume: (position: number) => {
        if (runtime) void runtime.session.resume(position);
      },
      playNext: () => {
        if (!runtime || !next || !onNext || nextPending.current) return;
        nextPending.current = true;
        void runtime.controller
          .pause()
          .then((result) => {
            if (!result.ok) {
              runtime.session.notice(result);
              nextPending.current = false;
              return;
            }
            runtime.session.save(true);
            onNext(next);
          })
          .catch(() => {
            nextPending.current = false;
            updatePlayerUI(store, { notice: "Could not open the next episode." });
          });
      },
    }),
    [degradation, runtime, store, item, next, onNext, perform, timeline, subtitleStore],
  );
  return (
    <PlayerContext.Provider value={value}>
      <div
        ref={rootRef}
        className="zivora-player"
        data-caption-size={captionSize}
        role="region"
        aria-label={`${item.title} video player`}
        tabIndex={0}
        onKeyDown={(event) => {
          updatePlayerUI(store, { focused: true });
          if (event.key === "Escape") {
            updatePlayerUI(store, { menu: null });
            revealControls(store);
          }
          const action = runtime?.controller.handleKey(event.nativeEvent);
          if (action) {
            revealControls(store);
            void action.then((result) => runtime?.session.notice(result));
          }
        }}
        onMouseMove={() => revealControls(store)}
        onFocus={(event) => {
          updatePlayerUI(store, { focused: event.target.matches(":focus-visible") });
          revealControls(store);
        }}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget))
            updatePlayerUI(store, { focused: false });
        }}
      >
        <VideoSurface videoRef={videoRef} />
        {degradationState.level < 3 && (
          <OptionalFeatureBoundary
            capability="subtitles"
            manager={degradation}
            onError={() => subtitleStore.setState({ healthy: false })}
          >
            <SubtitleRenderer key={userId ?? "guest"} store={subtitleStore} manager={degradation} />
          </OptionalFeatureBoundary>
        )}
        <PlayerOverlay />
        {degradationState.level < 1 && (
          <OptionalFeatureBoundary capability="ai" manager={degradation} fallback={null}>
            <ZivoraAI />
          </OptionalFeatureBoundary>
        )}
      </div>
    </PlayerContext.Provider>
  );
}
