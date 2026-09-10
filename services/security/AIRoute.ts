import { z } from "zod";
import {
  AIRequestSchema,
  AIResponseSchema,
  type AIRequest,
} from "@/features/ai/orchestrator/contracts";
export class AIRouteError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
export interface AISession {
  userId: string;
  consumeRateLimit(signal: AbortSignal): Promise<boolean>;
  answer(request: AIRequest, signal: AbortSignal): Promise<unknown>;
}
export async function readAIRequest(request: Request): Promise<AIRequest> {
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json")
    throw new Error("JSON required");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Body required");
  let size = 0,
    text = "";
  const decoder = new TextDecoder("utf-8", { fatal: true });
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 16384) throw new Error("Body too large");
      text += decoder.decode(chunk.value, { stream: true });
    }
    return AIRequestSchema.parse(JSON.parse(text + decoder.decode()));
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
export function createAIHandler(authenticate: (request: Request) => Promise<AISession | null>) {
  return async (request: Request): Promise<Response> => {
    const headers = {
      "Content-Type": "application/json",
      "Cache-Control": "private, no-store",
      Vary: "Cookie, Authorization",
    };
    const reply = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { ...headers, ...(status === 429 ? { "Retry-After": "60" } : {}) },
      });
    if (request.method !== "POST") return reply({ error: "Method not allowed" }, 405);
    const origin = request.headers.get("origin");
    if (
      (origin && origin !== new URL(request.url).origin) ||
      request.headers.get("sec-fetch-site") === "cross-site"
    )
      return reply({ error: "Cross-origin request denied" }, 403);
    const controller = new AbortController();
    const abort = () => controller.abort();
    request.signal.addEventListener("abort", abort, { once: true });
    if (request.signal.aborted) controller.abort();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const work = async () => {
        const session = await authenticate(request);
        if (!session) return reply({ error: "Sign in required" }, 401);
        z.string().uuid().parse(session.userId);
        let input: AIRequest;
        try {
          input = await readAIRequest(request);
        } catch {
          return reply({ error: "Invalid AI request" }, 400);
        }
        if (controller.signal.aborted) throw new Error("Request aborted");
        if (!(await session.consumeRateLimit(controller.signal)))
          return reply({ error: "AI rate limit exceeded" }, 429);
        if (controller.signal.aborted) throw new Error("Request aborted");
        return reply(AIResponseSchema.parse(await session.answer(input, controller.signal)));
      };
      const timeout = new Promise<Response>((resolve) => {
        timer = setTimeout(() => {
          controller.abort();
          resolve(reply({ error: "AI request timed out" }, 504));
        }, 25000);
      });
      return await Promise.race([work(), timeout]);
    } catch (error) {
      return reply(
        { error: error instanceof AIRouteError ? error.message : "AI temporarily unavailable" },
        error instanceof AIRouteError ? error.status : 503,
      );
    } finally {
      if (timer) clearTimeout(timer);
      request.signal.removeEventListener("abort", abort);
    }
  };
}

/** SSE facade deliberately streams application states, never provider events or hidden reasoning. */
export function createAIStreamHandler(
  authenticate: (request: Request) => Promise<AISession | null>,
) {
  return async (request: Request): Promise<Response> => {
    const headers = {
      "Content-Type": "application/json",
      "Cache-Control": "private, no-store",
      Vary: "Cookie, Authorization",
    };
    const reply = (body: unknown, status: number) =>
      new Response(JSON.stringify(body), { status, headers });
    if (request.method !== "POST") return reply({ error: "Method not allowed" }, 405);
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin)
      return reply({ error: "Cross-origin request denied" }, 403);
    const aborter = new AbortController();
    const abort = () => aborter.abort();
    request.signal.addEventListener("abort", abort, { once: true });
    try {
      const session = await authenticate(request);
      if (!session) return reply({ error: "Sign in required" }, 401);
      let input: AIRequest;
      try {
        input = await readAIRequest(request);
      } catch {
        return reply({ error: "Invalid AI request" }, 400);
      }
      if (!(await session.consumeRateLimit(aborter.signal)))
        return new Response(JSON.stringify({ error: "AI rate limit exceeded" }), {
          status: 429,
          headers: { ...headers, "Retry-After": "60" },
        });
      const encoder = new TextEncoder();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const send = (type: "accepted" | "retrieving" | "completed" | "error", value: unknown) =>
            controller.enqueue(
              encoder.encode(`event: ${type}\ndata: ${JSON.stringify(value)}\n\n`),
            );
          void (async () => {
            try {
              send("accepted", { version: 1 });
              send("retrieving", { version: 1 });
              const result = await Promise.race([
                session.answer(input, aborter.signal),
                new Promise<never>((_, reject) => {
                  timer = setTimeout(() => {
                    aborter.abort();
                    reject(new Error("AI request timed out"));
                  }, 25_000);
                }),
              ]);
              send("completed", AIResponseSchema.parse(result));
            } catch (error) {
              send("error", {
                error: error instanceof AIRouteError ? error.message : "AI temporarily unavailable",
              });
            } finally {
              if (timer) clearTimeout(timer);
              controller.close();
            }
          })();
        },
        cancel() {
          aborter.abort();
        },
      });
      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "private, no-store, no-transform",
          Connection: "keep-alive",
          Vary: "Cookie, Authorization",
          "X-Accel-Buffering": "no",
        },
      });
    } catch (error) {
      return reply(
        { error: error instanceof AIRouteError ? error.message : "AI temporarily unavailable" },
        error instanceof AIRouteError ? error.status : 503,
      );
    }
  };
}
