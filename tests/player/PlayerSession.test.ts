import { afterEach, describe, expect, it, vi } from "vitest";
import { PlayerController } from "@/core/player/PlayerController";
import { PlayerEngine } from "@/core/player/PlayerEngine";
import { PlaybackError } from "@/core/player/PlayerErrors";
import { MockAdapter } from "@/core/adapters/MockAdapter";
import { ProgressManager } from "@/core/playback/ProgressManager";
import { HistoryManager } from "@/core/playback/HistoryManager";
import { createPlayerStore } from "@/stores/player.store";
import { PlayerSession } from "@/components/player/PlayerSession";
import { attachPlaybackTelemetry } from "@/services/telemetry/PlaybackSession";
import { contentId, episodeId, versionId } from "../security/publicationFixture";
const item = { contentId, episodeId, title: "The Quiet Horizon", description: "Episode one" };
const grant = {
  contentId,
  episodeId,
  mediaVersionId: versionId,
  access: "public",
  token: null,
  expiresAt: null,
  manifestUrl: "https://media.test/media/v1/master.m3u8",
  objectBaseUrl: "https://media.test/media/v1/",
};
const disposals: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(disposals.splice(0).map((dispose) => dispose()));
  localStorage.clear();
  vi.useRealTimers();
});
function fixture(transport = vi.fn(async (): Promise<unknown> => grant)) {
  const adapter = new MockAdapter();
  const controller = new PlayerController(new PlayerEngine(adapter));
  const store = createPlayerStore();
  const progress = new ProgressManager();
  const session = new PlayerSession(controller, store, transport, progress);
  disposals.push(async () => {
    session.dispose();
    await controller.destroy();
  });
  return { adapter, controller, store, progress, session, transport };
}
describe("player session", () => {
  it("writes every five seconds and on pause, seek and disposal, always local before sync", async () => {
    vi.useFakeTimers();
    const adapter = new MockAdapter(),
      controller = new PlayerController(new PlayerEngine(adapter));
    const store = createPlayerStore(),
      progress = new ProgressManager();
    const save = vi.fn(async () => {
      expect(progress.load(`${contentId}:${episodeId}`)).not.toBeNull();
    });
    const session = new PlayerSession(controller, store, async () => grant, progress, {
      userId: null,
      sync: { save, restore: async () => null },
      history: new HistoryManager(null, null),
    });
    disposals.push(async () => {
      session.dispose();
      await controller.destroy();
    });
    await session.load(item);
    adapter.tick(50);
    save.mockClear();
    await vi.advanceTimersByTimeAsync(4999);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledOnce();
    await controller.pause();
    expect(save).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(5000);
    expect(save).toHaveBeenCalledTimes(2);
    await controller.seekTo(10);
    expect(save).toHaveBeenCalledTimes(3);
    expect(progress.load(`${contentId}:${episodeId}`)?.furthestPosition).toBe(50);
    session.dispose();
    expect(save).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(10000);
    expect(save).toHaveBeenCalledTimes(4);
  });
  it("requests a grant, loads through the controller and starts playback", async () => {
    const f = fixture();
    await f.session.load(item);
    expect(f.transport).toHaveBeenCalledWith(
      { action: "authorize", episodeId },
      expect.any(AbortSignal),
    );
    expect(f.adapter.playing).toBe(true);
    expect(f.store.getState().ui.phase).toBe("ready");
  });
  it("does not overwrite saved progress before the resume choice, then resumes through validated commands", async () => {
    const f = fixture();
    const key = `${contentId}:${episodeId}`;
    f.progress.save({
      contentId: key,
      position: 90,
      duration: 7200,
      updatedAt: new Date().toISOString(),
    });
    await f.session.load(item);
    expect(f.store.getState().ui.resumePosition).toBe(90);
    expect(f.adapter.playing).toBe(false);
    f.session.save(true);
    expect(f.progress.load(key)?.position).toBe(90);
    const commands: string[] = [];
    f.controller.on("commandaudit", (event) => {
      if (event.status === "executed") commands.push(event.command!.type);
    });
    await f.session.resume(90);
    expect(commands).toEqual(["SEEK_TO", "PLAY"]);
    expect(f.adapter.position).toBe(90);
  });
  it("retries at the last known position after a fatal error", async () => {
    const f = fixture();
    await f.session.load(item);
    f.adapter.tick(85);
    f.adapter.emit(
      "error",
      new PlaybackError("broken", {
        code: "BAD_MEDIA",
        category: "media",
        fatal: true,
        recoverable: false,
      }),
    );
    await f.session.retry();
    expect(f.adapter.loads.at(-1)?.startPosition).toBe(85);
    expect(f.adapter.playing).toBe(true);
  });
  it("rejects grants for other media and ignores stale authorization after disposal", async () => {
    const f = fixture(vi.fn(async () => ({ ...grant, contentId: versionId })));
    await f.session.load(item);
    expect(f.adapter.loads).toHaveLength(0);
    expect(f.store.getState().ui.phase).toBe("failed");
    let finish!: (value: unknown) => void;
    const other = fixture(
      vi.fn(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      ),
    );
    const loading = other.session.load(item);
    other.session.dispose();
    finish(grant);
    await loading;
    expect(other.adapter.loads).toHaveLength(0);
  });
  it("supports content-level grants and keeps telemetry failures separate from playback", async () => {
    const f = fixture(vi.fn(async () => ({ ...grant, episodeId: null })));
    const send = vi.fn<(body: string) => boolean>(() => false);
    const stop = attachPlaybackTelemetry(f.controller, contentId, send);
    await f.session.load({ ...item, episodeId: null });
    expect(f.transport).toHaveBeenCalledWith(
      { action: "authorize", contentId },
      expect.any(AbortSignal),
    );
    expect(f.adapter.playing).toBe(true);
    stop();
    expect(send).toHaveBeenCalled();
    const payload = JSON.parse(send.mock.calls[0][0]);
    expect(payload).not.toHaveProperty("manifestUrl");
  });
});
