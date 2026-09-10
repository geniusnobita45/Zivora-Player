import { describe, expect, it, vi } from "vitest";
import { BookmarkManager } from "@/core/playback/BookmarkManager";
import { HistoryManager } from "@/core/playback/HistoryManager";
import { ResumeManager } from "@/core/playback/ResumeManager";
const userId = "11111111-1111-4111-8111-111111111111",
  contentId = "22222222-2222-4222-8222-222222222222";
const value = {
  id: "33333333-3333-4333-8333-333333333333",
  userId,
  contentId,
  episodeId: null,
  position: 20,
  title: "Saved moment",
  updatedAt: "2026-09-09T00:00:00.000Z",
  deleted: false,
};
describe("playback managers", () => {
  it("saves, restores and tombstones bookmarks locally before a failing remote call", async () => {
    const storage = new Map<string, string>();
    const port = {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => {
        storage.set(k, v);
      },
    };
    const remote = {
      list: async () => [],
      put: vi.fn(async () => {
        throw new Error("offline");
      }),
    };
    const manager = new BookmarkManager(userId, port, remote),
      health = vi.fn();
    manager.health.on(health);
    expect(manager.save(value)).toBe(true);
    expect(storage.size).toBe(1);
    await manager.flush();
    expect(health).toHaveBeenCalled();
    const restored = new BookmarkManager(userId, port);
    expect(restored.list(value)).toEqual([value]);
    expect(restored.remove(value.id)).toBe(true);
    expect(restored.list(value)).toEqual([]);
    expect(new BookmarkManager(contentId, port).list(value)).toEqual([]);
    manager.dispose();
    restored.dispose();
  });
  it("keeps latest bookmark edits over an old acknowledgement and rejects reassignment", async () => {
    let finish!: (v: unknown) => void;
    const put = vi.fn(
      () =>
        new Promise((r) => {
          finish = r;
        }),
    );
    const manager = new BookmarkManager(userId, null, { list: async () => [], put });
    manager.save(value);
    const task = manager.flush();
    manager.save({ ...value, title: "New title", updatedAt: "2026-09-09T00:00:01.000Z" });
    finish(value);
    await task;
    expect(manager.list(value)[0].title).toBe("New title");
    expect(manager.save({ ...value, userId: contentId })).toBe(false);
    manager.dispose();
  });
  it("records completion monotonically and sorts history by latest progress", () => {
    const manager = new HistoryManager(userId, null);
    const progress = {
      userId,
      contentId,
      episodeId: null,
      sessionId: null,
      position: 99,
      duration: 100,
      furthestPosition: 99,
      updatedAt: value.updatedAt,
    };
    manager.record(progress);
    manager.record({ ...progress, position: 5, updatedAt: "2026-09-09T00:00:01.000Z" });
    expect(manager.list()[0].completed).toBe(true);
    expect(manager.list()[0].progress.position).toBe(5);
    expect(manager.record({ ...progress, userId: contentId })).toBe(false);
    const resume = new ResumeManager();
    expect(resume.shouldAdvance(100, 100)).toBe(true);
    expect(resume.shouldAdvance(99, 100)).toBe(false);
  });
});
