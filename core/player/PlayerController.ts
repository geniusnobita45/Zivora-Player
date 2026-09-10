import { PlayerEngine } from "./PlayerEngine";
import { PlayerCommandValidator, type ValidationError } from "./PlayerCommandValidator";
import { type PlayerCommand, type CommandMeta } from "./PlayerCommand";
import { TypedEventEmitter, type PlayerEventMap } from "./PlayerEvents";
import { PlaybackError, toPlaybackError } from "./PlayerErrors";
import { ShakaAdapter } from "@/core/adapters/ShakaAdapter";
import type { PlaybackAdapter } from "@/core/adapters/PlaybackAdapter";
import { BrowserPlayerPresentation } from "./PlayerPresentation";
import { keyboardCommand } from "./PlayerKeyboard";
import type { PlayerConfigInput } from "./PlayerConfig";
import type { ManifestManager } from "@/core/streaming/ManifestManager";
import type { Result } from "@/types/result";

export interface CommandAuditEvent {
  id: number;
  at: number;
  status: "accepted" | "executed" | "rejected" | "failed";
  command?: Readonly<PlayerCommand>;
  error?: ValidationError | PlaybackError;
}
interface ControllerEvents extends PlayerEventMap {
  commandaudit: Readonly<CommandAuditEvent>;
}
export type DispatchResult = Result<PlayerCommand, ValidationError | PlaybackError>;

/** Public application API. All interactive actions are validated and audited here. */
export class PlayerController {
  private readonly validator: PlayerCommandValidator;
  private readonly events = new TypedEventEmitter<ControllerEvents>();
  private readonly subscriptions: (() => void)[] = [];
  private sequence = 0;
  private disposed = false;
  private destruction: Promise<void> | null = null;
  private loadGeneration = 0;
  private manifest: ManifestManager | null = null;
  private unsubscribeManifest: (() => void) | null = null;
  constructor(
    private readonly engine: PlayerEngine,
    private readonly now: () => number = Date.now,
  ) {
    this.validator = new PlayerCommandValidator(now);
    const forward = <K extends keyof PlayerEventMap>(type: K) =>
      this.subscriptions.push(
        engine.on(type, (payload) => {
          this.events.emit(type, payload as ControllerEvents[K]);
        }),
      );
    forward("ready");
    forward("manifestloaded");
    forward("playing");
    forward("paused");
    forward("timeupdate");
    forward("seeking");
    forward("seeked");
    forward("bufferingstart");
    forward("bufferingend");
    forward("qualitychange");
    forward("audiochange");
    forward("textchange");
    forward("ratechange");
    forward("volumechange");
    forward("error");
    forward("ended");
    forward("destroyed");
  }
  static forVideo(
    video: HTMLVideoElement,
    container: HTMLElement = video,
    config: PlayerConfigInput = {},
    adapterOptions: import("@/core/adapters/ShakaAdapter").ShakaAdapterOptions = {},
  ): PlayerController {
    return new PlayerController(
      new PlayerEngine(new ShakaAdapter(video, adapterOptions), config, {
        presentation: new BrowserPlayerPresentation(video, container),
      }),
    );
  }
  on<K extends keyof ControllerEvents>(
    type: K,
    listener: (payload: ControllerEvents[K]) => void | Promise<void>,
  ) {
    return this.events.on(type, listener);
  }
  off<K extends keyof ControllerEvents>(
    type: K,
    listener: (payload: ControllerEvents[K]) => void | Promise<void>,
  ) {
    this.events.off(type, listener);
  }
  getSnapshot() {
    return this.engine.getSnapshot();
  }
  getStreamingSnapshot() {
    return this.engine.getStreamingSnapshot();
  }
  setSkipSegments(input: unknown): void {
    this.engine.setSkipSegments(input);
  }
  load(url: string, startPosition?: number): Promise<void> {
    ++this.loadGeneration;
    this.releaseManifest();
    return this.engine.load(url, startPosition);
  }
  /** Takes ownership of the manager's timers until another load or destruction. */
  async loadSignedManifest(manager: ManifestManager, startPosition?: number): Promise<void> {
    const generation = ++this.loadGeneration;
    this.releaseManifest();
    this.manifest = manager;
    const signed = await manager.load();
    if (this.disposed || generation !== this.loadGeneration) return;
    this.unsubscribeManifest = manager.on("refreshed", (value) => {
      this.engine.updateManifestUrl(value.url);
    });
    const loading = this.engine.load(signed.url, startPosition);
    const current = manager.getSnapshot();
    if (current) this.engine.updateManifestUrl(current.url);
    await loading;
  }
  swapAdapter(create: () => PlaybackAdapter): Promise<void> {
    return this.engine.swapAdapter(create);
  }
  async dispatch(input: unknown): Promise<DispatchResult> {
    const id = ++this.sequence;
    const parsed = this.validator.parse(input, this.engine.getCommandContext());
    if (!parsed.ok) {
      this.audit({ id, status: "rejected", error: parsed.error });
      return parsed;
    }
    const command = parsed.value;
    if (this.disposed) {
      const error = new PlaybackError("Player controller is destroyed", {
        code: "CONTROLLER_DESTROYED",
        category: "adapter",
        fatal: false,
        recoverable: false,
      });
      this.audit({ id, status: "rejected", command, error });
      return { ok: false, error };
    }
    this.audit({ id, status: "accepted", command });
    try {
      await this.engine.execute(command);
      this.audit({ id, status: "executed", command });
      return { ok: true, value: command };
    } catch (cause) {
      const error = toPlaybackError(cause);
      this.audit({ id, status: "failed", command, error });
      return { ok: false, error };
    }
  }
  private audit(event: Omit<CommandAuditEvent, "at">): void {
    this.events.emit("commandaudit", Object.freeze({ ...event, at: this.now() }));
  }
  private meta(meta: CommandMeta) {
    return { source: meta.source ?? "ui", reason: meta.reason, issuedAt: this.now() };
  }
  play(meta: CommandMeta = {}) {
    return this.dispatch({ type: "PLAY", ...this.meta(meta) });
  }
  pause(meta: CommandMeta = {}) {
    return this.dispatch({ type: "PAUSE", ...this.meta(meta) });
  }
  togglePlay(meta: CommandMeta = {}) {
    return this.dispatch({ type: "TOGGLE_PLAY", ...this.meta(meta) });
  }
  seekTo(seconds: number, meta: CommandMeta = {}) {
    return this.dispatch({ type: "SEEK_TO", seconds, ...this.meta(meta) });
  }
  seekBy(delta: number, meta: CommandMeta = {}) {
    return this.dispatch({ type: "SEEK_BY", delta, ...this.meta(meta) });
  }
  setVolume(level: number, meta: CommandMeta = {}) {
    return this.dispatch({ type: "SET_VOLUME", level, ...this.meta(meta) });
  }
  setMuted(muted: boolean, meta: CommandMeta = {}) {
    return this.dispatch({ type: "SET_MUTED", muted, ...this.meta(meta) });
  }
  setPlaybackRate(rate: number, meta: CommandMeta = {}) {
    return this.dispatch({ type: "SET_RATE", rate, ...this.meta(meta) });
  }
  selectQuality(id: string, meta: CommandMeta = {}) {
    return this.dispatch({ type: "SELECT_QUALITY", id, ...this.meta(meta) });
  }
  enableAutoQuality(meta: CommandMeta = {}) {
    return this.dispatch({ type: "ENABLE_AUTO_QUALITY", ...this.meta(meta) });
  }
  selectAudio(lang: string, meta: CommandMeta = {}) {
    return this.dispatch({ type: "SELECT_AUDIO", lang, ...this.meta(meta) });
  }
  selectSubtitle(
    lang: string | null,
    meta: CommandMeta = {},
    kind?: "original" | "literal" | "natural",
  ) {
    return this.dispatch({
      type: "SELECT_SUBTITLE",
      lang,
      ...(kind ? { kind } : {}),
      ...this.meta(meta),
    });
  }
  toggleFullscreen(meta: CommandMeta = {}) {
    return this.dispatch({ type: "TOGGLE_FULLSCREEN", ...this.meta(meta) });
  }
  togglePictureInPicture(meta: CommandMeta = {}) {
    return this.dispatch({ type: "TOGGLE_PIP", ...this.meta(meta) });
  }
  skipSegment(segmentId: string, meta: CommandMeta = {}) {
    return this.dispatch({ type: "SKIP_SEGMENT", segmentId, ...this.meta(meta) });
  }
  handleKey(event: KeyboardEvent): Promise<DispatchResult> | null {
    if (event.defaultPrevented) return null;
    const target = event.target;
    if (
      typeof Element !== "undefined" &&
      target instanceof Element &&
      target.closest(
        'input, textarea, select, button, a[href], [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="slider"]',
      )
    )
      return null;
    const command = keyboardCommand(event, this.getSnapshot(), this.now());
    if (!command) return null;
    event.preventDefault();
    return this.dispatch(command);
  }
  private releaseManifest(): void {
    this.unsubscribeManifest?.();
    this.unsubscribeManifest = null;
    this.manifest?.destroy();
    this.manifest = null;
  }
  destroy(): Promise<void> {
    if (this.destruction) return this.destruction;
    this.disposed = true;
    ++this.loadGeneration;
    this.releaseManifest();
    this.destruction = this.engine.destroy().finally(() => {
      this.subscriptions.splice(0).forEach((unsubscribe) => unsubscribe());
      this.events.clear();
    });
    return this.destruction;
  }
}
