// @vitest-environment node
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OfflineProgress } from "@/services/sync/OfflineProgress";
import { ProgressSync } from "@/services/sync/ProgressSync";
import { ProgressRecordSchema, mergeProgress } from "@/types/progress";
import { PlaybackHealth } from "@/core/playback/PlaybackHealth";
import { ProgressManager } from "@/core/playback/ProgressManager";
const userId = "11111111-1111-4111-8111-111111111111";
const otherUser = "22222222-2222-4222-8222-222222222222";
const contentId = "33333333-3333-4333-8333-333333333333";
const record = (position = 90, second = 0, furthestPosition = position) =>
  ProgressRecordSchema.parse({
    userId,
    contentId,
    episodeId: null,
    position,
    duration: 7200,
    furthestPosition,
    updatedAt: new Date(Date.UTC(2026, 8, 9, 0, 0, second)).toISOString(),
  });
const cleanup: (() => Promise<unknown> | void)[] = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const close of cleanup.splice(0)) await close();
});
function local(name = crypto.randomUUID(), owner: string | null = userId) {
  const value = new OfflineProgress(owner, new PlaybackHealth(), name);
  cleanup.push(() => value.close());
  return value;
}
describe("local-first progress", () => {
  it("resolves rewinds by timestamp and merges furthest even from an older update", () => {
    expect(mergeProgress(record(90), record(20, 1)).position).toBe(20);
    expect(mergeProgress(record(90), record(20, 1)).furthestPosition).toBe(90);
    expect(mergeProgress(record(20, 2), record(300, 1)).position).toBe(20);
    expect(mergeProgress(record(20, 2), record(300, 1)).furthestPosition).toBe(300);
    expect(mergeProgress(record(90), record(20)).position).toBe(90);
    expect(() => mergeProgress(record(), { ...record(), userId: otherUser })).toThrow();
  });
  it("checkpoints synchronously and isolates health subscribers and user journals", () => {
    const memory = new Map<string, string>();
    const storage = {
      getItem: (k: string) => memory.get(k) ?? null,
      setItem: (k: string, v: string) => {
        memory.set(k, v);
      },
    };
    const health = new PlaybackHealth(),
      report = vi.fn();
    health.on(() => {
      throw new Error("observer");
    });
    health.on(report);
    const a = new ProgressManager(storage, userId, health),
      b = new ProgressManager(storage, otherUser, health);
    const { position, duration, updatedAt } = record();
    a.save({ contentId, position, duration, updatedAt });
    a.save({ contentId, position: 10, duration, updatedAt: record(10, 1).updatedAt });
    expect(a.load(contentId)?.furthestPosition).toBe(90);
    expect(b.load(contentId)).toBeNull();
    expect(a.save({ position: Infinity })).toBe(false);
    expect(report).toHaveBeenCalled();
  });
  it("persists an offline queue across database reopen and excludes other users", async () => {
    const name = crypto.randomUUID(),
      first = local(name);
    await first.save(record());
    await first.close();
    const reopened = local(name);
    expect(await reopened.all()).toEqual([record()]);
    expect((await reopened.get(record()))?.position).toBe(90);
    const other = local(name, otherUser);
    expect(await other.all()).toEqual([]);
    expect(await other.save(record())).toBeNull();
  });
  it("keeps a new checkpoint pending when an old request is acknowledged", async () => {
    const db = local();
    const sent = record();
    await db.save(sent);
    await db.save(record(20, 1));
    await db.acknowledge(sent, sent);
    expect(await db.all()).toEqual([record(20, 1, 90)]);
    await db.acknowledge(record(20, 1, 90), record(20, 1, 90));
    expect(await db.all()).toEqual([]);
  });
  it("retains a higher local furthest position when the server returns a newer rewind", async () => {
    const db = local();
    await db.save(record(200));
    await db.acknowledge(record(200), record(20, 1));
    expect(await db.all()).toEqual([record(20, 1, 200)]);
  });
  it("falls back to memory if IndexedDB is unavailable", async () => {
    const db = local(),
      report = vi.fn();
    db.health.on(report);
    const original = globalThis.indexedDB;
    Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: undefined });
    try {
      await expect(db.save(record())).resolves.not.toBeNull();
      expect(await db.all()).toEqual([record()]);
      expect(report).toHaveBeenCalled();
    } finally {
      Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: original });
    }
  });
  it("coalesces offline writes, flushes on online, and does not upload guests", async () => {
    let online = false;
    const events = new EventTarget(),
      db = local();
    const push = vi.fn(async (value: unknown) => value);
    const sync = new ProgressSync(db, { push, pull: async () => null }, () => online, events);
    cleanup.push(() => sync.dispose());
    await sync.save(record());
    await sync.save(record(25, 1));
    await sync.flush();
    expect(push).not.toHaveBeenCalled();
    online = true;
    events.dispatchEvent(new Event("online"));
    await sync.flush();
    expect(push).toHaveBeenCalledOnce();
    expect(push.mock.calls[0][0]).toEqual(record(25, 1, 90));
    expect(await db.all()).toEqual([]);
    const guest = local(crypto.randomUUID(), null),
      guestSync = new ProgressSync(guest, { push, pull: async () => null });
    cleanup.push(() => guestSync.dispose());
    await guestSync.save({ ...record(), userId: null }, true);
    expect(push).toHaveBeenCalledOnce();
  });
  it("backs off failed pushes and preserves newer writes during an in-flight request", async () => {
    const db = local();
    await db.save(record());
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const push = vi.fn(async () => {
      throw new Error("offline");
    });
    const sync = new ProgressSync(db, { push, pull: async () => null }, () => true, null);
    cleanup.push(() => sync.dispose());
    await sync.flush();
    expect(push).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(999);
    expect(push).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await sync.flush();
    expect(push).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1999);
    expect(push).toHaveBeenCalledTimes(2);
    sync.dispose();
    let finish!: (value: unknown) => void;
    const transport = vi.fn(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const next = new ProgressSync(
      db,
      { push: transport, pull: async () => null },
      () => true,
      null,
    );
    cleanup.push(() => next.dispose());
    const flushing = next.flush();
    await vi.waitFor(() => expect(transport).toHaveBeenCalled());
    await db.save(record(30, 1));
    finish(record());
    await flushing;
    expect(await db.all()).toEqual([record(30, 1, 90)]);
  });
  it("rejects cross-user responses without acknowledging queued records", async () => {
    const db = local();
    await db.save(record());
    const sync = new ProgressSync(
      db,
      {
        push: async () => ({ ...record(), userId: otherUser }),
        pull: async () => ({ ...record(), userId: otherUser }),
      },
      () => true,
      null,
    );
    cleanup.push(() => sync.dispose());
    await sync.flush();
    expect(await db.all()).toHaveLength(1);
    expect(await sync.restore(record())).toEqual(record());
  });
});
