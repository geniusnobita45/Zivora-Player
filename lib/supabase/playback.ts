import "server-only";
import { z } from "zod";
import { createServerSupabaseClient } from "./server";
import type { PlaybackDataRepository } from "@/services/security/PlaybackDataRoute";
import { BookmarkSchema, ProgressRecordSchema } from "@/types/progress";
const RowSchema = z.object({
  user_id: z.string().uuid(),
  content_id: z.string().uuid(),
  episode_id: z.string().uuid().nullable(),
  position_s: z.number(),
  updated_at: z.string(),
});
const progressRow = RowSchema.extend({ furthest_position_s: z.number(), duration_s: z.number() });
const bookmarkRow = RowSchema.extend({
  id: z.string().uuid(),
  title: z.string(),
  deleted: z.boolean(),
});
function progress(input: unknown, sessionId: string | null = null) {
  const v = progressRow.parse(input);
  return ProgressRecordSchema.parse({
    userId: v.user_id,
    contentId: v.content_id,
    episodeId: v.episode_id,
    position: v.position_s,
    duration: v.duration_s,
    furthestPosition: v.furthest_position_s,
    updatedAt: new Date(v.updated_at).toISOString(),
    sessionId,
  });
}
function bookmark(input: unknown) {
  const v = bookmarkRow.parse(input);
  return BookmarkSchema.parse({
    id: v.id,
    userId: v.user_id,
    contentId: v.content_id,
    episodeId: v.episode_id,
    position: v.position_s,
    title: v.title,
    deleted: v.deleted,
    updatedAt: new Date(v.updated_at).toISOString(),
  });
}
/** This client carries the caller's token. RLS, never a service key, owns mutations. */
export async function playbackRepository(request: Request): Promise<PlaybackDataRepository | null> {
  const authorization = request.headers.get("authorization");
  const bearer = authorization ? /^Bearer ([A-Za-z0-9._-]{1,8192})$/.exec(authorization) : null;
  if ((authorization && !bearer) || (!authorization && !request.headers.has("cookie"))) return null;
  const db = await createServerSupabaseClient(bearer?.[1]);
  const { data: auth, error } = await db.auth.getUser(bearer?.[1]);
  if (error || !auth.user) return null;
  const userId = z.string().uuid().parse(auth.user.id);
  return {
    userId,
    async getProgress(target) {
      let query = db
        .from("watch_progress")
        .select("*")
        .eq("user_id", userId)
        .eq("content_id", target.contentId);
      query = target.episodeId
        ? query.eq("episode_id", target.episodeId)
        : query.is("episode_id", null);
      const { data, error } = await query.maybeSingle();
      if (error) throw error;
      return data ? progress(data) : null;
    },
    async saveProgress(value) {
      const { data, error } = await db
        .rpc("upsert_progress", {
          p_content_id: value.contentId,
          p_episode_id: value.episodeId,
          p_position_s: value.position,
          p_duration_s: value.duration,
          p_furthest_position_s: value.furthestPosition,
          p_updated_at: value.updatedAt,
          p_session_id: value.sessionId,
        })
        .single();
      if (error) throw error;
      return progress(data, value.sessionId);
    },
    async listBookmarks(target) {
      let query = db
        .from("bookmarks")
        .select("*")
        .eq("user_id", userId)
        .eq("content_id", target.contentId);
      query = target.episodeId
        ? query.eq("episode_id", target.episodeId)
        : query.is("episode_id", null);
      const { data, error } = await query.order("position_s").limit(10000);
      if (error) throw error;
      return (data ?? []).map(bookmark);
    },
    async saveBookmark(value) {
      const { data, error } = await db
        .from("bookmarks")
        .upsert(
          {
            id: value.id,
            user_id: userId,
            content_id: value.contentId,
            episode_id: value.episodeId,
            position_s: value.position,
            title: value.title,
            deleted: value.deleted,
            updated_at: value.updatedAt,
          },
          { onConflict: "id" },
        )
        .select("*")
        .single();
      if (error) throw error;
      return bookmark(data);
    },
  };
}
