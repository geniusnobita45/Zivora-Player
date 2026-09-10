// @vitest-environment node
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { uid, request } from "./fixtures";
const factories = vi.hoisted(() => ({ server: vi.fn(), service: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: factories.server }));
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabaseClient: factories.service }));
import { aiSession } from "@/lib/supabase/ai";

function query(data: unknown) {
  const value = { data, error: null };
  const chain = {
    select: () => chain,
    eq: () => chain,
    limit: () => chain,
    abortSignal: () => chain,
    maybeSingle: async () => value,
    then: <T>(resolve: (value: { data: unknown; error: null }) => T) =>
      Promise.resolve(value).then(resolve),
  };
  return chain;
}
function fixture(
  options: { entitled?: boolean; state?: string; history?: boolean; conversation?: unknown } = {},
) {
  const content = {
    id: request.contentId,
    state: options.state ?? "READY",
    access_level: "private",
  };
  const user = {
    id: uid(2),
    app_metadata: { content_ids: options.entitled ? [request.contentId] : [] },
    user_metadata: { content_ids: [request.contentId] },
  };
  const caller = {
    auth: { getUser: vi.fn(async () => ({ data: { user }, error: null })) },
    from: vi.fn((name: string) =>
      query(
        name === "watch_progress"
          ? []
          : name === "ai_conversations"
            ? (options.conversation ?? null)
            : {
                enabled: true,
                maximum_cost_tier: "standard",
                allow_history: options.history ?? true,
              },
      ),
    ),
  };
  const db = {
    from: vi.fn(() => query(content)),
    rpc: vi.fn((name: string) =>
      query(
        name === "ai_media_scope"
          ? [{ episode_id: null, episode_order: 0, media_version_id: uid(3), duration_s: 100 }]
          : name === "append_ai_exchange"
            ? uid(20)
            : true,
      ),
    ),
  };
  factories.server.mockResolvedValue(caller);
  factories.service.mockReturnValue(db);
  return { caller, db };
}
const http = () =>
  new Request("https://zivora.test/api/ai/ask", {
    headers: { authorization: "Bearer test-token" },
  });
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("OPENAI_API_KEY", "fixture-key");
});
afterEach(() => vi.unstubAllEnvs());
describe("authenticated AI session", () => {
  it("rejects missing or malformed credentials before creating a service client", async () => {
    expect(await aiSession(new Request("https://zivora.test/api/ai/ask"))).toBeNull();
    expect(
      await aiSession(
        new Request("https://zivora.test/api/ai/ask", { headers: { authorization: "Basic bad" } }),
      ),
    ).toBeNull();
    expect(factories.service).not.toHaveBeenCalled();
  });
  it("does not trust editable user_metadata for entitlement", async () => {
    const { db } = fixture();
    const session = await aiSession(http());
    await expect(session!.answer(request, new AbortController().signal)).rejects.toMatchObject({
      status: 403,
    });
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it("refuses non-READY content before retrieval", async () => {
    const { db } = fixture({ entitled: true, state: "PROCESSING" });
    const session = await aiSession(http());
    await expect(session!.answer(request, new AbortController().signal)).rejects.toMatchObject({
      status: 404,
    });
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it("checks conversation scope before model access", async () => {
    const { db } = fixture({
      entitled: true,
      conversation: { id: uid(20), content_id: uid(99), episode_id: null },
    });
    const session = await aiSession(http());
    await expect(
      session!.answer({ ...request, conversationId: uid(20) }, new AbortController().signal),
    ).rejects.toMatchObject({ status: 404 });
    expect(db.rpc.mock.calls.map(([name]) => name)).toEqual(["ai_media_scope"]);
  });
  it("uses the authenticated owner for rate reservations and honors history opt-out", async () => {
    const { db } = fixture({ entitled: true, history: false });
    const session = await aiSession(http()),
      signal = new AbortController().signal;
    expect(await session!.consumeRateLimit(signal)).toBe(true);
    const response = await session!.answer({ ...request, question: "pause" }, signal);
    expect(response).toMatchObject({
      command: { type: "PAUSE", source: "ai" },
      conversationId: null,
    });
    expect(db.rpc.mock.calls.map(([name]) => name)).toEqual([
      "consume_ai_request",
      "ai_media_scope",
    ]);
    expect(db.rpc).toHaveBeenCalledWith("consume_ai_request", { user_id: uid(2) });
  });
});
