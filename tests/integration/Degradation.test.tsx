import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { render, screen } from "@testing-library/react";
import { MockAdapter } from "@/core/adapters/MockAdapter";
import { PlayerController } from "@/core/player/PlayerController";
import { PlayerEngine } from "@/core/player/PlayerEngine";
import {
  DegradationManager,
  type DegradationCapability,
} from "@/services/degradation/DegradationManager";
import { OptionalFeatureBoundary } from "@/components/shared/OptionalFeatureBoundary";

const manifest = "https://media.example.com/v1/master.m3u8";
const response = z.object({ ok: z.literal(true) }).strict();
const capabilities: DegradationCapability[] = [
  "ai",
  "progressSync",
  "subtitles",
  "chapters",
  "thumbnails",
  "analytics",
];
const failures = ["throws", "hangs", "malformed"] as const;

afterEach(() => {
  vi.useRealTimers();
});

describe("optional service isolation", () => {
  it.each(
    capabilities.flatMap((capability) => failures.map((failure) => [capability, failure] as const)),
  )("keeps MockAdapter playback running when %s %s", async (capability, failure) => {
    const adapter = new MockAdapter();
    const controller = new PlayerController(new PlayerEngine(adapter));
    await controller.load(manifest);
    await controller.play();
    expect(controller.getSnapshot().state).toBe("playing");

    vi.useFakeTimers();
    const manager = new DegradationManager({ timeoutMs: 20, baseRetryMs: 100 });
    const operation = () => {
      if (failure === "throws") throw new Error(`${capability} unavailable`);
      if (failure === "hangs") return new Promise<never>(() => undefined);
      return { ok: "not-a-boolean" };
    };
    const isolated = manager.run({
      capability,
      operation,
      schema: response,
      fallback: { ok: true as const },
      retry: () => ({ ok: true }),
    });
    if (failure === "hangs") await vi.advanceTimersByTimeAsync(20);
    await expect(isolated).resolves.toEqual({ ok: true });

    expect(adapter.playing).toBe(true);
    expect(controller.getSnapshot().state).toBe("playing");
    expect(manager.getSnapshot().health[capability]).toBe("retrying");
    manager.dispose();
    await controller.destroy();
  });

  it("computes the frozen hierarchy and recovers with exponential background retries", async () => {
    vi.useFakeTimers();
    const manager = new DegradationManager({ baseRetryMs: 10, maxRetryMs: 40 });
    expect(manager.getSnapshot()).toMatchObject({ level: 0, label: "Full experience" });
    manager.reportUnavailable("ai");
    expect(manager.getSnapshot().level).toBe(1);
    manager.reportUnavailable("progressSync");
    expect(manager.getSnapshot().level).toBe(2);
    manager.reportUnavailable("thumbnails");
    expect(manager.getSnapshot().level).toBe(3);
    manager.reportLocalProgress(false);
    expect(manager.getSnapshot()).toMatchObject({ level: 4, label: "Video only" });

    manager.reportLocalProgress(true);
    let attempts = 0;
    manager.reportUnavailable("thumbnails", () => {
      attempts++;
      if (attempts < 2) throw new Error("still unavailable");
      return true;
    });
    await vi.advanceTimersByTimeAsync(10);
    expect(manager.getSnapshot().health.thumbnails).toBe("retrying");
    await vi.advanceTimersByTimeAsync(20);
    expect(manager.getSnapshot().health.thumbnails).toBe("healthy");
    expect(attempts).toBe(2);
    manager.dispose();
  });

  it("contains React render failures without touching active playback", async () => {
    const adapter = new MockAdapter();
    const controller = new PlayerController(new PlayerEngine(adapter));
    await controller.load(manifest);
    await controller.play();
    const manager = new DegradationManager({ baseRetryMs: 10 });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    function BrokenSubtitles(): never {
      throw new Error("renderer failed");
    }

    render(
      <OptionalFeatureBoundary
        capability="subtitles"
        manager={manager}
        fallback={<span>Playback controls remain available</span>}
      >
        <BrokenSubtitles />
      </OptionalFeatureBoundary>,
    );

    expect(screen.getByText("Playback controls remain available")).toBeTruthy();
    expect(manager.getSnapshot()).toMatchObject({ level: 3 });
    expect(controller.getSnapshot().state).toBe("playing");
    expect(adapter.playing).toBe(true);
    consoleError.mockRestore();
    manager.dispose();
    await controller.destroy();
  });
});
