import { playbackRepository } from "@/lib/supabase/playback";
import { createPlaybackDataHandler } from "@/services/security/PlaybackDataRoute";
export const runtime = "nodejs";
export const GET = createPlaybackDataHandler("bookmarks", playbackRepository);
export const POST = GET;
