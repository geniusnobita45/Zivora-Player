// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AIGateway } from "@/features/ai/gateway/AIGateway";
import { MemoryAIUsageRepository } from "@/features/ai/gateway/AIUsageRepository";
import { MockProvider } from "@/features/ai/gateway/MockProvider";
import { ModelRouter } from "@/features/ai/gateway/ModelRouter";

const OutputSchema = z.object({ answer: z.string() }).strict();

function gateway(primary: MockProvider, fallback: MockProvider, usage: MemoryAIUsageRepository) {
  return new AIGateway(
    new ModelRouter(
      [
        { provider: primary, costTier: "low" },
        { provider: fallback, costTier: "low" },
      ],
      [
        {
          taskType: "cheap_chat",
          costTier: "low",
          fallbackChain: [primary.name, fallback.name],
        },
      ],
    ),
    usage,
  );
}

describe("AIGateway routing", () => {
  it("falls back after provider errors and records the successful route", async () => {
    const first = vi.fn(() => Promise.reject(new Error("provider unavailable")));
    const second = vi.fn(() => ({ answer: "fallback" }));
    const usage = new MemoryAIUsageRepository();
    const ai = gateway(
      new MockProvider("primary", "primary-model", { generate: first }),
      new MockProvider("fallback", "fallback-model", { generate: second }),
      usage,
    );

    await expect(
      ai.generate({
        taskType: "cheap_chat",
        system: "Return JSON.",
        prompt: "Hello",
        schemaName: "answer",
        schema: OutputSchema,
        options: { retries: 0 },
      }),
    ).resolves.toEqual({ answer: "fallback" });
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
    expect(usage.records).toHaveLength(1);
    expect(usage.records[0]).toMatchObject({
      provider: "fallback",
      model: "fallback-model",
      attempts: 2,
      success: true,
      error_code: null,
    });
  });

  it("times out a hanging provider and continues its fallback chain", async () => {
    const usage = new MemoryAIUsageRepository();
    const ai = gateway(
      new MockProvider("hanging", "hanging-model", {
        generate: () => new Promise(() => undefined),
      }),
      new MockProvider("healthy", "healthy-model", {
        generate: () => ({ answer: "healthy" }),
      }),
      usage,
    );

    await expect(
      ai.generate({
        taskType: "cheap_chat",
        system: "Return JSON.",
        prompt: "Hello",
        schemaName: "answer",
        schema: OutputSchema,
        options: { retries: 0, timeoutMs: 100 },
      }),
    ).resolves.toEqual({ answer: "healthy" });
    expect(usage.records[0]).toMatchObject({ provider: "healthy", attempts: 2, success: true });
  });

  it("retries a provider before moving to its fallback", async () => {
    const attempt = vi
      .fn<() => Promise<{ answer: string }>>()
      .mockRejectedValueOnce(new Error("transient"))
      .mockResolvedValueOnce({ answer: "retried" });
    const fallback = vi.fn(() => ({ answer: "unused" }));
    const usage = new MemoryAIUsageRepository();
    const ai = gateway(
      new MockProvider("retryable", "retryable-model", { generate: attempt }),
      new MockProvider("fallback", "fallback-model", { generate: fallback }),
      usage,
    );

    await expect(
      ai.generate({
        taskType: "cheap_chat",
        system: "Return JSON.",
        prompt: "Hello",
        schemaName: "answer",
        schema: OutputSchema,
        options: { retries: 1 },
      }),
    ).resolves.toEqual({ answer: "retried" });
    expect(attempt).toHaveBeenCalledTimes(2);
    expect(fallback).not.toHaveBeenCalled();
    expect(usage.records[0]).toMatchObject({
      provider: "retryable",
      attempts: 2,
      success: true,
    });
  });

  it("respects the maximum cost tier before making a request", () => {
    const premium = new MockProvider("premium", "premium-model");
    const router = new ModelRouter(
      [{ provider: premium, costTier: "premium" }],
      [{ taskType: "complex_reasoning", costTier: "premium", fallbackChain: ["premium"] }],
    );
    expect(() => router.route("complex_reasoning", "standard")).toThrow("exceeds cost tier");
  });

  it("reports and accounts for an exhausted fallback chain", async () => {
    const first = new MockProvider("first", "first-model", {
      generate: () => Promise.reject(new Error("first failed")),
    });
    const second = new MockProvider("second", "second-model", {
      generate: () => Promise.reject(new Error("second failed")),
    });
    const usage = new MemoryAIUsageRepository();
    const ai = gateway(first, second, usage);

    await expect(
      ai.generate({
        taskType: "cheap_chat",
        system: "Return JSON.",
        prompt: "Hello",
        schemaName: "answer",
        schema: OutputSchema,
        options: { retries: 0 },
      }),
    ).rejects.toMatchObject({ code: "ALL_PROVIDERS_FAILED" });
    expect(usage.records[0]).toMatchObject({
      provider: "second",
      attempts: 2,
      success: false,
      error_code: "ALL_PROVIDERS_FAILED",
    });
  });
});
