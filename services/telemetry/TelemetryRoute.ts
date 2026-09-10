import { z } from "zod";
import { TelemetryBatchSchema } from "@/types/telemetry";

export interface TelemetrySink {
  ingest(batch: unknown, authenticatedUserId: string | null): Promise<void>;
}
const IdentitySchema = z.object({ id: z.string().uuid() }).strict();

async function readJson(request: Request): Promise<unknown> {
  const type = request.headers.get("content-type")?.split(";")[0].trim();
  if (type !== "application/json") throw new Error("JSON required");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Body required");
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0;
  let text = "";
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 65_536) throw new Error("Too large");
      text += decoder.decode(chunk.value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

/** Telemetry is deliberately fail-silent to callers once its payload is valid. */
export function createTelemetryHandler(dependencies: {
  sink: TelemetrySink;
  authenticate: (request: Request) => Promise<unknown | null>;
}) {
  return async (request: Request): Promise<Response> => {
    const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
    if (request.method !== "POST")
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers,
      });
    const origin = request.headers.get("origin");
    if (
      (origin && origin !== new URL(request.url).origin) ||
      request.headers.get("sec-fetch-site") === "cross-site"
    )
      return new Response(JSON.stringify({ error: "Cross-origin request denied" }), {
        status: 403,
        headers,
      });
    let batch: z.infer<typeof TelemetryBatchSchema>;
    try {
      batch = TelemetryBatchSchema.parse(await readJson(request));
    } catch {
      return new Response(JSON.stringify({ error: "Invalid telemetry payload" }), {
        status: 400,
        headers,
      });
    }
    try {
      const identity = await dependencies.authenticate(request);
      const userId = identity ? IdentitySchema.parse(identity).id : null;
      await dependencies.sink.ingest(batch, userId);
    } catch {
      // Beacon callers cannot use a useful response. Drop rather than creating a retry loop.
    }
    return new Response(JSON.stringify({ accepted: true }), { status: 202, headers });
  };
}
