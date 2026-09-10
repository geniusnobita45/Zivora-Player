import { z } from "zod";
import {
  BookmarkSchema,
  PlaybackTargetSchema,
  ProgressRecordSchema,
  type Bookmark,
  type PlaybackTarget,
  type ProgressRecord,
} from "@/types/progress";
export interface PlaybackDataRepository {
  userId: string;
  getProgress(target: PlaybackTarget): Promise<unknown>;
  saveProgress(value: ProgressRecord): Promise<unknown>;
  listBookmarks(target: PlaybackTarget): Promise<unknown>;
  saveBookmark(value: Bookmark): Promise<unknown>;
}
const headers = {
  "Content-Type": "application/json",
  "Cache-Control": "private, no-store",
  Vary: "Cookie, Authorization",
};
async function readJson(request: Request): Promise<unknown> {
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json")
    throw new Error("JSON required");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Body required");
  let bytes = 0,
    text = "";
  const decoder = new TextDecoder("utf-8", { fatal: true });
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 16384) throw new Error("Too large");
      text += decoder.decode(chunk.value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
export function createPlaybackDataHandler(
  kind: "progress" | "bookmarks",
  authenticate: (request: Request) => Promise<PlaybackDataRepository | null>,
) {
  return async (request: Request): Promise<Response> => {
    const reply = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers });
    const origin = request.headers.get("origin");
    if (
      (origin && origin !== new URL(request.url).origin) ||
      request.headers.get("sec-fetch-site") === "cross-site"
    )
      return reply({ error: "Cross-origin request denied" }, 403);
    if (!["GET", "POST"].includes(request.method))
      return reply({ error: "Method not allowed" }, 405);
    let input: unknown;
    try {
      if (request.method === "GET") {
        const params = Object.fromEntries(new URL(request.url).searchParams);
        input = PlaybackTargetSchema.parse({ ...params, episodeId: params.episodeId ?? null });
      } else
        input = (kind === "progress" ? ProgressRecordSchema : BookmarkSchema).parse(
          await readJson(request),
        );
    } catch {
      return reply({ error: "Invalid playback data" }, 400);
    }
    try {
      const repository = await authenticate(request);
      if (!repository) return reply({ error: "Sign in required" }, 401);
      const userId = z.string().uuid().parse(repository.userId);
      if (request.method === "POST" && (input as ProgressRecord | Bookmark).userId !== userId)
        return reply({ error: "Wrong user" }, 403);
      if (kind === "progress") {
        const value =
          request.method === "GET"
            ? await repository.getProgress(input as PlaybackTarget)
            : await repository.saveProgress(input as ProgressRecord);
        const progress = ProgressRecordSchema.nullable().parse(value);
        if (
          progress &&
          (progress.userId !== userId ||
            progress.contentId !== (input as PlaybackTarget).contentId ||
            progress.episodeId !== (input as PlaybackTarget).episodeId)
        )
          throw new Error("Wrong progress scope");
        if (request.method === "POST" && !progress) throw new Error("Missing acknowledgement");
        return reply({ progress });
      }
      if (request.method === "GET") {
        const bookmarks = z
          .array(BookmarkSchema)
          .max(10000)
          .parse(await repository.listBookmarks(input as PlaybackTarget));
        if (
          bookmarks.some(
            (v) =>
              v.userId !== userId ||
              v.contentId !== (input as PlaybackTarget).contentId ||
              v.episodeId !== (input as PlaybackTarget).episodeId,
          )
        )
          throw new Error("Wrong bookmark scope");
        return reply({ bookmarks });
      }
      const bookmark = BookmarkSchema.parse(await repository.saveBookmark(input as Bookmark));
      const sent = input as Bookmark;
      if (
        bookmark.userId !== userId ||
        bookmark.id !== sent.id ||
        bookmark.contentId !== sent.contentId ||
        bookmark.episodeId !== sent.episodeId
      )
        throw new Error("Wrong acknowledgement");
      return reply({ bookmark });
    } catch {
      return reply({ error: "Playback data temporarily unavailable" }, 503);
    }
  };
}
