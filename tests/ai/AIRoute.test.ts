// @vitest-environment node
import { describe, expect, it, vi, afterEach } from "vitest";
import { createAIHandler, createAIStreamHandler } from "@/services/security/AIRoute";
import { request, uid } from "./fixtures";
function http(body: unknown = request, headers: Record<string, string> = {}) {
  return new Request("https://zivora.test/api/ai/ask", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}
afterEach(() => vi.useRealTimers());
describe("AI route boundaries", () => {
  it("streams only stable application states and validates the terminal response", async () => {
    const body = {
      answer: "Safe",
      confidence: 0,
      candidates: [],
      conversationId: null,
      intent: "general",
      boundary: { boundary_episode_order: 0, boundary_seconds: 30 },
    };
    const handler = createAIStreamHandler(async () => ({
      userId: uid(2),
      consumeRateLimit: async () => true,
      answer: async () => body,
    }));
    const response = await handler(http());
    expect(response.headers.get("Content-Type")).toContain("text/event-stream");
    const text = await response.text();
    expect(text).toContain("event: accepted");
    expect(text).toContain("event: retrieving");
    expect(text).toContain("event: completed");
    expect(text).not.toContain("provider");
  });
  it("validates successful responses and rejects malformed output", async () => {
    const body = {
      answer: "Safe",
      confidence: 0,
      candidates: [],
      conversationId: null,
      intent: "general",
      boundary: { boundary_episode_order: 0, boundary_seconds: 30 },
    };
    const answer = vi.fn(async () => body);
    const handler = createAIHandler(async () => ({
      userId: uid(2),
      consumeRateLimit: async () => true,
      answer,
    }));
    const response = await handler(http());
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toEqual(body);
    const bad = createAIHandler(async () => ({
      userId: uid(2),
      consumeRateLimit: async () => true,
      answer: async () => ({ answer: "Missing fields" }),
    }));
    expect((await bad(http())).status).toBe(503);
  });
  it("requires authentication and rejects cross-origin or malformed input", async () => {
    expect((await createAIHandler(async () => null)(http())).status).toBe(401);
    const answer = vi.fn(async () => ({ answer: "ok" }));
    const auth = vi.fn(async () => ({
      userId: uid(2),
      consumeRateLimit: async () => true,
      answer,
    }));
    const handler = createAIHandler(auth);
    expect((await handler(http(request, { origin: "https://evil.test" }))).status).toBe(403);
    expect(auth).not.toHaveBeenCalled();
    expect((await handler(http({ ...request, userId: uid(99) }))).status).toBe(400);
    expect(answer).not.toHaveBeenCalled();
  });
  it("enforces the database rate reservation before generation", async () => {
    const answer = vi.fn(async () => ({ answer: "ok" }));
    const handler = createAIHandler(async () => ({
      userId: uid(2),
      consumeRateLimit: async () => false,
      answer,
    }));
    const response = await handler(http());
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("60");
    expect(answer).not.toHaveBeenCalled();
  });
  it("bounds hangs and masks provider failures", async () => {
    vi.useFakeTimers();
    const handler = createAIHandler(async () => ({
      userId: uid(2),
      consumeRateLimit: async () => true,
      answer: () => new Promise(() => {}),
    }));
    const pending = handler(http());
    await vi.advanceTimersByTimeAsync(25001);
    expect((await pending).status).toBe(504);
    const broken = createAIHandler(async () => {
      throw new Error("secret provider token");
    });
    const response = await broken(http());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("secret");
  });
});
