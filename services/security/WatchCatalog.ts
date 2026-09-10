import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/lib/supabase/types";
import { WatchSelectionSchema } from "@/types/watch";
import { PlaybackAuthorizationError } from "./PlaybackAuthorization";
const Id = z.string().uuid();
const Active = z.object({
  id: Id,
  state: z.literal("READY"),
  published_at: z.string().datetime({ offset: true }),
});
const Episode = z.object({
  id: Id,
  title: z.string().min(1),
  order_index: z.number().int(),
  season_id: Id,
  active: Active,
});
const episodeSelect =
  "id,title,order_index,season_id,active:media_versions!episodes_active_media_version_fkey!inner(id,state,published_at)";
export class WatchCatalog {
  constructor(private readonly client: SupabaseClient<Database>) {}
  async select(contentInput: unknown, episodeInput?: unknown) {
    const contentId = Id.parse(contentInput);
    const requested = episodeInput === undefined ? undefined : Id.parse(episodeInput);
    const result = await this.client
      .from("content")
      .select("id,title,active_media_version_id")
      .eq("id", contentId)
      .eq("state", "READY")
      .maybeSingle();
    if (result.error) throw new Error("Catalog unavailable");
    if (!result.data) throw new PlaybackAuthorizationError(404, "This title is not available yet");
    const content = z
      .object({ id: Id, title: z.string().min(1), active_media_version_id: Id.nullable() })
      .parse(result.data);
    if (!requested && content.active_media_version_id) {
      const version = await this.client
        .from("media_versions")
        .select("id,state,published_at")
        .eq("id", content.active_media_version_id)
        .eq("content_id", contentId)
        .eq("state", "READY")
        .not("published_at", "is", null)
        .maybeSingle();
      if (version.error) throw new Error("Catalog unavailable");
      if (Active.safeParse(version.data).success)
        return WatchSelectionSchema.parse({
          current: { contentId, episodeId: null, title: content.title },
          next: null,
        });
    }
    const show = await this.client
      .from("shows")
      .select("id")
      .eq("content_id", contentId)
      .maybeSingle();
    if (show.error) throw new Error("Catalog unavailable");
    if (!show.data) throw new PlaybackAuthorizationError(404, "No published media is available");
    const seasons = await this.client
      .from("seasons")
      .select("id,season_number")
      .eq("show_id", Id.parse(show.data.id))
      .order("season_number")
      .limit(1000);
    if (seasons.error) throw new Error("Catalog unavailable");
    const ordered = z
      .array(z.object({ id: Id, season_number: z.number().int() }))
      .parse(seasons.data);
    let current: z.infer<typeof Episode> | null = null;
    if (requested) {
      const episode = await this.client
        .from("episodes")
        .select(episodeSelect)
        .eq("id", requested)
        .eq("active.state", "READY")
        .not("active.published_at", "is", null)
        .maybeSingle();
      if (episode.error) throw new Error("Catalog unavailable");
      const parsed = Episode.safeParse(episode.data);
      if (!parsed.success || !ordered.some((season) => season.id === parsed.data.season_id))
        throw new PlaybackAuthorizationError(404, "Episode is unavailable for this title");
      current = parsed.data;
    }
    let next: z.infer<typeof Episode> | null = null;
    for (const season of ordered) {
      if (
        current &&
        season.season_number < ordered.find((s) => s.id === current!.season_id)!.season_number
      )
        continue;
      let query = this.client
        .from("episodes")
        .select(episodeSelect)
        .eq("season_id", season.id)
        .eq("active.state", "READY")
        .not("active.published_at", "is", null)
        .order("order_index")
        .limit(2);
      if (current?.season_id === season.id) query = query.gt("order_index", current.order_index);
      const episodes = await query;
      if (episodes.error) throw new Error("Catalog unavailable");
      const playable = z.array(Episode).parse(episodes.data);
      if (!current) current = playable.shift() ?? null;
      next = playable[0] ?? null;
      if (next) break;
    }
    if (!current) throw new PlaybackAuthorizationError(404, "No published episode is available");
    const item = (episode: z.infer<typeof Episode>) => ({
      contentId,
      episodeId: episode.id,
      title: content.title,
      description: `Season ${ordered.find((s) => s.id === episode.season_id)!.season_number} · ${episode.title}`,
    });
    return WatchSelectionSchema.parse({ current: item(current), next: next ? item(next) : null });
  }
}
