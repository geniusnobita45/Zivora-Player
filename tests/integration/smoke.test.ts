import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { MockAdapter } from "@/core/adapters/MockAdapter";
import { PlayerController } from "@/core/player/PlayerController";
import { PlayerEngine } from "@/core/player/PlayerEngine";
import { OfflineProgress } from "@/services/sync/OfflineProgress";
import { ProgressSync } from "@/services/sync/ProgressSync";

describe("Zivora playback smoke path", () => {
  it("loads, plays, seeks, changes quality, accepts AI seek, and survives sync failure", async () => {
    const adapter = new MockAdapter();
    const engine = new PlayerEngine(adapter);
    const controller = new PlayerController(engine, () => 0);

    await controller.load("https://media.example.com/v1/master.m3u8");
    expect(engine.getSnapshot().state).toBe("ready");
    await controller.play();
    await controller.seekTo(120);
    await controller.selectQuality("720");
    const aiSeek = await controller.dispatch({
      type: "SEEK_TO",
      seconds: 240,
      source: "ai",
      issuedAt: 0,
      reason: "smoke test",
    });
    expect(aiSeek.ok).toBe(true);

    const local = new OfflineProgress("00000000-0000-0000-0000-000000000001", undefined, `smoke-${Date.now()}`);
    const sync = new ProgressSync(local, {
      push: async () => {
        throw new Error("Supabase unavailable");
      },
      pull: async () => null,
    }, () => true, null, 0);
    await sync.save({
      userId: "00000000-0000-0000-0000-000000000001",
      contentId: "00000000-0000-0000-0000-000000000002",
      episodeId: null,
      sessionId: null,
      position: 240,
      duration: 7200,
      furthestPosition: 240,
      updatedAt: "2026-09-10T00:00:00.000Z",
    }, true);
    expect(await local.get({
      contentId: "00000000-0000-0000-0000-000000000002",
      episodeId: null,
    })).not.toBeNull();
    expect(engine.getSnapshot().state).toBe("playing");
    sync.dispose();
    await controller.destroy();
  });
});
