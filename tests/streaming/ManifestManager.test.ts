// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ManifestManager } from "@/core/streaming/ManifestManager";
const managers: ManifestManager[] = [];
const signed = (token: string, expiresAt = 60000) => ({
  url: `https://media.example.com/v1/master.m3u8?token=${token}`,
  expiresAt,
});
function manager(options: ConstructorParameters<typeof ManifestManager>[0]) {
  const value = new ManifestManager(options);
  managers.push(value);
  return value;
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});
afterEach(() => {
  managers.splice(0).forEach((value) => value.destroy());
  vi.useRealTimers();
});
describe("signed manifest lifecycle", () => {
  it("deduplicates concurrent authorization and refreshes before expiry", async () => {
    const resolve = vi
      .fn()
      .mockResolvedValueOnce(signed("old"))
      .mockResolvedValue(signed("new", 120000));
    const value = manager({ resolve, refreshAheadMs: 10000 });
    const first = value.load();
    const second = value.load();
    expect(first).toBe(second);
    await first;
    expect(resolve).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(49999);
    expect(resolve).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(resolve).toHaveBeenCalledTimes(2);
    expect(value.getSnapshot()).toEqual(signed("new", 120000));
  });
  it("refreshes short-lived tokens without a tight timer loop", async () => {
    const resolve = vi
      .fn()
      .mockResolvedValueOnce(signed("old", 10000))
      .mockResolvedValue(signed("new", 20000));
    const value = manager({ resolve });
    await value.load();
    await vi.advanceTimersByTimeAsync(4999);
    expect(resolve).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(resolve).toHaveBeenCalledTimes(2);
  });
  it("retains current authorization on refresh failure and retries independently", async () => {
    const resolve = vi
      .fn()
      .mockResolvedValueOnce(signed("old"))
      .mockRejectedValueOnce(new Error("Auth offline"))
      .mockResolvedValue(signed("new", 120000));
    const value = manager({ resolve, refreshAheadMs: 10000, retryMs: 5000 });
    const errors = vi.fn();
    value.on("refresherror", errors);
    await value.load();
    await vi.advanceTimersByTimeAsync(50000);
    expect(value.getSnapshot()).toEqual(signed("old"));
    expect(errors).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(5000);
    expect(value.getSnapshot()).toEqual(signed("new", 120000));
  });
  it.each([
    { url: "file:///media", expiresAt: 60000 },
    signed("expired", 0),
    { url: "https://media.example.com/file", expiresAt: "tomorrow" },
  ])("rejects malformed or expired authorization %j", async (input) => {
    const value = manager({ resolve: vi.fn().mockResolvedValue(input) });
    await expect(value.load()).rejects.toThrow();
    expect(value.getSnapshot()).toBeNull();
  });
  it("refuses to renew into a different immutable media version", async () => {
    const resolve = vi
      .fn()
      .mockResolvedValueOnce(signed("first"))
      .mockResolvedValue({ url: "https://media.example.com/v2/master.m3u8", expiresAt: 120000 });
    const value = manager({ resolve });
    await value.load();
    await expect(value.refresh()).rejects.toThrow("immutable");
    expect(value.getSnapshot()).toEqual(signed("first"));
  });
  it("aborts authorization on disposal and ignores a late provider result", async () => {
    let complete!: (value: unknown) => void;
    const resolve = vi.fn(
      () =>
        new Promise<unknown>((done) => {
          complete = done;
        }),
    );
    const value = manager({ resolve });
    const events = vi.fn();
    value.on("refreshed", events);
    const pending = value.load().catch((error: unknown) => error);
    await Promise.resolve();
    value.destroy();
    complete(signed("late"));
    expect(await pending).toBeInstanceOf(Error);
    expect(events).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("times out a provider that ignores its abort signal", async () => {
    const value = manager({ resolve: () => new Promise(() => {}), timeoutMs: 50 });
    const pending = value.load().catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(50);
    expect(await pending).toBeInstanceOf(Error);
  });
});
describe("manifest health checks", () => {
  it("uses a direct HEAD without fetching or proxying media bytes", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 200 }));
    const value = manager({ resolve: async () => signed("test"), fetch: fetcher });
    expect(await value.healthCheck()).toMatchObject({ healthy: false, reason: "unloaded" });
    await value.load();
    expect(await value.healthCheck()).toMatchObject({ healthy: true, status: 200 });
    expect(fetcher).toHaveBeenCalledWith(
      signed("test").url,
      expect.objectContaining({ method: "HEAD", credentials: "omit", redirect: "error" }),
    );
    fetcher.mockResolvedValueOnce(new Response(null, { status: 403 }));
    expect(await value.healthCheck()).toMatchObject({
      healthy: false,
      status: 403,
      reason: "http",
    });
  });
  it("reports an unavailable network without altering the manifest", async () => {
    const value = manager({
      resolve: async () => signed("test"),
      fetch: vi.fn<typeof fetch>().mockRejectedValue(new Error("Offline")),
    });
    await value.load();
    expect(await value.healthCheck()).toMatchObject({ healthy: false, reason: "network" });
    expect(value.getSnapshot()).toEqual(signed("test"));
  });
  it("aborts a hanging health request", async () => {
    const fetcher = vi.fn<typeof fetch>(() => new Promise(() => {}));
    const value = manager({ resolve: async () => signed("test"), fetch: fetcher, timeoutMs: 50 });
    await value.load();
    const pending = value.healthCheck();
    await vi.advanceTimersByTimeAsync(50);
    expect(await pending).toMatchObject({ healthy: false, reason: "network" });
    expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });
});
