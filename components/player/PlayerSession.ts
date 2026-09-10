import type { PlayerController, DispatchResult } from "@/core/player/PlayerController";
import {
  PlaybackRequestAuthorization,
  playbackTransport,
  type PlaybackRequestContext,
} from "@/services/security/PlaybackRequestAuthorization";
import { ProgressManager } from "@/core/playback/ProgressManager";
import type { ProgressSync } from "@/services/sync/ProgressSync";
import type { HistoryManager } from "@/core/playback/HistoryManager";
import type { ProgressRecord } from "@/types/progress";
import { resumePosition } from "@/core/playback/ResumeManager";
import { PlaybackGrantSchema } from "@/types/playbackAuthorization";
import { WatchItemSchema, type WatchItem } from "@/types/watch";
import {
  refreshPlayerStore,
  updatePlayerUI,
  revealControls,
  type PlayerStore,
} from "@/stores/player.store";

export type PlaybackTransport = (body: unknown, signal?: AbortSignal) => Promise<unknown>;
export function commandNotice(result: DispatchResult): string | null {
  if (result.ok) return null;
  if (result.error.code === "AUTOPLAY_BLOCKED") return "Press Play to start the video.";
  if (
    result.error.code === "PRESENTATION_UNAVAILABLE" ||
    result.error.code === "PRESENTATION_FAILED"
  )
    return "This browser could not open that viewing mode.";
  return "That control is unavailable right now. Try again when playback is ready.";
}
/** Session coordination only. Playback behavior stays inside the controller-owned engine. */
export class PlayerSession {
  private authorization: PlaybackRequestAuthorization | null = null;
  private abort: AbortController | null = null;
  private generation = 0;
  private item: WatchItem | null = null;
  private saving = false;
  private savedAt = 0;
  private sessionId: string | null = null;
  private mediaVersionId: string | null = null;
  private clock: ReturnType<typeof setInterval>;
  private readonly unsubscribe: (() => void)[];
  constructor(
    readonly controller: PlayerController,
    readonly store: PlayerStore,
    private readonly transport: PlaybackTransport = playbackTransport,
    private readonly progress = new ProgressManager(),
    private readonly persistence?: {
      userId: string | null;
      sync: Pick<ProgressSync, "save" | "restore">;
      history: HistoryManager;
    },
  ) {
    this.clock = setInterval(() => this.save(false), 5000);
    this.unsubscribe = [
      controller.on("timeupdate", () => this.save(false)),
      ...(["paused", "seeked", "ended"] as const).map((event) =>
        controller.on(event, () => this.save(true)),
      ),
    ];
  }
  readonly authorizeRequest = (request: PlaybackRequestContext) =>
    this.authorization?.authorizeRequest(request) ?? Promise.resolve(undefined);
  telemetrySessionId() {
    return this.sessionId;
  }
  telemetryMediaVersionId() {
    return this.mediaVersionId;
  }
  notice(result: DispatchResult) {
    const message = commandNotice(result);
    if (message) {
      updatePlayerUI(this.store, { notice: message });
      revealControls(this.store);
    }
  }
  async load(input: unknown, retry = false): Promise<void> {
    const item = WatchItemSchema.parse(input);
    const position = retry ? this.controller.getSnapshot().position : 0;
    this.save(true);
    this.saving = false;
    this.item = item;
    if (!retry) {
      this.sessionId = globalThis.crypto?.randomUUID?.() ?? null;
      this.mediaVersionId = null;
    }
    const generation = ++this.generation;
    // The local checkpoint is immediate. A bounded parallel restore never seeks a running video.
    let restoreTimer: ReturnType<typeof setTimeout> | undefined;
    const restored = this.persistence
      ? Promise.race([
          this.persistence.sync
            .restore(item)
            .then((value) => {
              if (value)
                this.progress.save({
                  contentId: `${item.contentId}:${item.episodeId ?? "movie"}`,
                  position: value.position,
                  duration: value.duration,
                  furthestPosition: value.furthestPosition,
                  updatedAt: value.updatedAt,
                });
            })
            .catch(() => this.progress.health.report("sync", "network")),
          new Promise<void>((resolve) => {
            restoreTimer = setTimeout(resolve, 400);
          }),
        ]).finally(() => {
          if (restoreTimer) clearTimeout(restoreTimer);
        })
      : Promise.resolve();
    this.abort?.abort();
    this.abort = new AbortController();
    const abort = this.abort;
    const timeout = setTimeout(() => abort.abort(), 15_000);
    updatePlayerUI(this.store, {
      phase: "authorizing",
      loadError: null,
      notice: null,
      resumePosition: null,
      menu: null,
      controlsVisible: true,
    });
    try {
      if (!this.controller.getSnapshot().paused) await this.controller.pause();
      const grant = PlaybackGrantSchema.parse(
        await this.transport(
          item.episodeId
            ? { action: "authorize", episodeId: item.episodeId }
            : { action: "authorize", contentId: item.contentId },
          abort.signal,
        ),
      );
      if (generation !== this.generation) return;
      if (grant.contentId !== item.contentId || grant.episodeId !== item.episodeId)
        throw new Error("Playback grant does not match this title");
      this.mediaVersionId = grant.mediaVersionId;
      this.authorization = new PlaybackRequestAuthorization(grant, this.transport);
      updatePlayerUI(this.store, { phase: "loading" });
      await this.controller.load(grant.manifestUrl, position);
      if (generation !== this.generation) return;
      refreshPlayerStore(this.store, this.controller);
      await restored;
      if (generation !== this.generation) return;
      const resume = retry
        ? null
        : resumePosition(this.progress.load(this.key()), this.controller.getSnapshot().duration);
      updatePlayerUI(this.store, { phase: "ready", resumePosition: resume });
      this.saving = resume === null;
      if (resume === null) this.notice(await this.controller.play());
    } catch {
      if (generation === this.generation)
        updatePlayerUI(this.store, {
          phase: "failed",
          loadError: "We couldn’t start this video. Check your connection and access, then retry.",
          controlsVisible: true,
        });
    } finally {
      clearTimeout(timeout);
    }
  }
  async retry() {
    if (this.item) await this.load(this.item, true);
  }
  async resume(position: number) {
    const generation = this.generation;
    const result = await this.controller.seekTo(position);
    if (generation !== this.generation) return;
    if (!result.ok) {
      this.notice(result);
      return;
    }
    this.saving = true;
    updatePlayerUI(this.store, { resumePosition: null });
    this.save(true);
    this.notice(await this.controller.play());
  }
  private key() {
    return `${this.item!.contentId}:${this.item!.episodeId ?? "movie"}`;
  }
  save(force: boolean): void {
    if (!this.item || !this.saving) return;
    const snapshot = this.controller.getSnapshot();
    const now = Date.now();
    if (snapshot.duration <= 0 || (!force && (snapshot.paused || now - this.savedAt < 5000)))
      return;
    const previous = this.progress.load(this.key());
    const updatedAt = new Date(
      Math.max(now, previous ? Date.parse(previous.updatedAt) + 1 : 0),
    ).toISOString();
    this.progress.save({
      contentId: this.key(),
      position: snapshot.position,
      duration: snapshot.duration,
      updatedAt,
    });
    const saved = this.progress.load(this.key());
    if (saved && this.persistence) {
      const record: ProgressRecord = {
        ...this.item,
        userId: this.persistence.userId,
        sessionId: this.sessionId,
        position: saved.position,
        duration: saved.duration,
        furthestPosition: saved.furthestPosition ?? saved.position,
        updatedAt: saved.updatedAt,
      };
      // Strip catalog labels before the strict persistence boundary; only timing and identifiers travel.
      const {
        contentId,
        episodeId,
        userId,
        sessionId,
        position,
        duration,
        furthestPosition,
        updatedAt,
      } = record;
      const value = {
        contentId,
        episodeId,
        userId,
        sessionId,
        position,
        duration,
        furthestPosition,
        updatedAt,
      };
      this.persistence.history.record(value);
      void this.persistence.sync
        .save(value, force)
        .catch(() => this.progress.health.report("sync", "storage"));
    }
    this.savedAt = now;
  }
  dispose(): void {
    this.save(true);
    clearInterval(this.clock);
    ++this.generation;
    this.abort?.abort();
    this.unsubscribe.forEach((unsubscribe) => unsubscribe());
  }
}
