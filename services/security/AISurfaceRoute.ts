import { z, type ZodType } from "zod";
import type { AIRequest } from "@/features/ai/orchestrator/contracts";
import { createAIHandler, type AISession } from "./AIRoute";

/** Converts a frozen feature request into the one authorized orchestrator contract. */
export function createAISurfaceHandler<T>(
  schema: ZodType<T>,
  toAIRequest: (input: T) => AIRequest,
  authenticate: (request: Request) => Promise<AISession | null>,
) {
  const answer = createAIHandler(authenticate);
  return async (request: Request): Promise<Response> => {
    if (request.method !== "POST") return answer(request);
    try {
      if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json")
        return new Response(JSON.stringify({ error: "JSON required" }), { status: 415 });
      const input = schema.parse(await request.json());
      const mapped = toAIRequest(input);
      const headers = new Headers(request.headers);
      headers.set("content-type", "application/json");
      return answer(
        new Request(request.url, {
          method: "POST",
          headers,
          body: JSON.stringify(mapped),
          signal: request.signal,
        }),
      );
    } catch (error) {
      return new Response(JSON.stringify({ error: "Invalid AI request" }), {
        status: error instanceof z.ZodError ? 400 : 503,
        headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store" },
      });
    }
  };
}
