import { z } from "zod";
import { PlaybackRequestSchema } from "@/types/playbackAuthorization";
import { WatchSelectionSchema } from "@/types/watch";
import { PlaybackAuthorization, PlaybackAuthorizationError } from "./PlaybackAuthorization";

const headers = {
  "Content-Type": "application/json",
  "Cache-Control": "private, no-store",
  Vary: "Cookie, Authorization",
};
async function readBody(request: Request): Promise<unknown> {
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json")
    throw new Error("Invalid body");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Missing body");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 16 * 1024) throw new Error("Body too large");
      chunks.push(chunk.value);
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
export function createPlaybackHandler(dependencies: {
  authorization: () => PlaybackAuthorization;
  authenticate: (request: Request) => Promise<unknown | null>;
  catalog?: (contentId: string, episodeId?: string) => Promise<unknown>;
}) {
  return async (request: Request): Promise<Response> => {
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin)
      return new Response(JSON.stringify({ error: "Cross-origin request denied" }), {
        status: 403,
        headers,
      });
    let command: z.infer<typeof PlaybackRequestSchema>;
    try {
      command = PlaybackRequestSchema.parse(await readBody(request));
    } catch {
      return new Response(JSON.stringify({ error: "Invalid playback request" }), {
        status: 400,
        headers,
      });
    }
    try {
      if (command.action === "catalog") {
        const selection = WatchSelectionSchema.parse(
          await dependencies.catalog?.(command.contentId, command.episodeId),
        );
        const user =
          request.headers.has("cookie") || request.headers.has("authorization")
            ? await dependencies.authenticate(request)
            : null;
        const identity = user === null ? null : z.object({ id: z.string().uuid() }).parse(user).id;
        return new Response(
          JSON.stringify({ ...selection, ...(identity ? { userId: identity } : {}) }),
          { status: 200, headers },
        );
      }
      const service = dependencies.authorization();
      const user = await dependencies.authenticate(request);
      const result =
        command.action === "authorize"
          ? command.episodeId
            ? await service.authorize(user, command.episodeId)
            : await service.authorizeContent(user, command.contentId)
          : command.action === "renew"
            ? await service.renew(user, command.token)
            : await service.signObjects(user, command.token, command.paths);
      return new Response(JSON.stringify(result), { status: 200, headers });
    } catch (error) {
      return new Response(
        JSON.stringify({
          error:
            error instanceof PlaybackAuthorizationError
              ? error.message
              : "Playback authorization unavailable",
        }),
        {
          status: error instanceof PlaybackAuthorizationError ? error.status : 503,
          headers,
        },
      );
    }
  };
}
