import { createR2Storage } from "@/lib/r2/client";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import {
  PlaybackAuthorization,
  PlaybackAuthorizationError,
} from "@/services/security/PlaybackAuthorization";
import { SupabasePlaybackCatalog } from "@/services/security/SupabasePlaybackCatalog";
import { createPlaybackHandler } from "@/services/security/PlaybackRoute";
import { WatchCatalog } from "@/services/security/WatchCatalog";

export const runtime = "nodejs";
export const POST = createPlaybackHandler({
  catalog: (contentId, episodeId) =>
    new WatchCatalog(createServiceSupabaseClient()).select(contentId, episodeId),
  authorization: () => {
    const storage = createR2Storage();
    return new PlaybackAuthorization(
      new SupabasePlaybackCatalog(createServiceSupabaseClient()),
      {
        sign: (key, seconds) => storage.privateStore.signedUrl(key, seconds),
        privateUrl: (key) => storage.privateStore.objectUrl(key),
        publicUrl: storage.publicUrl,
      },
      process.env.PLAYBACK_SIGNING_SECRET ?? "",
    );
  },
  authenticate: async (request) => {
    const authorization = request.headers.get("authorization");
    if (!authorization && !request.headers.get("cookie")) return null;
    const bearer = authorization ? /^Bearer ([A-Za-z0-9._-]{1,8192})$/.exec(authorization) : null;
    if (authorization && !bearer)
      throw new PlaybackAuthorizationError(401, "Invalid authentication");
    const supabase = await createServerSupabaseClient();
    const { data, error } = await supabase.auth.getUser(bearer?.[1]);
    if (error || !data.user) throw new PlaybackAuthorizationError(401, "Invalid authentication");
    return data.user;
  },
});
