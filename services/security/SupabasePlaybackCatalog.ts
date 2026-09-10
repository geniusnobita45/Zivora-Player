import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/lib/supabase/types";
import type { PlaybackCatalog } from "./PlaybackAuthorization";

const IdSchema = z.string().uuid();
export class SupabasePlaybackCatalog implements PlaybackCatalog {
  constructor(private readonly client: SupabaseClient<Database>) {}
  async getContent(contentId: string, versionId?: string): Promise<unknown | null> {
    IdSchema.parse(contentId);
    if (versionId) IdSchema.parse(versionId);
    const content = await this.client
      .from("content")
      .select("id,state,access_level,active_media_version_id")
      .eq("id", contentId)
      .eq("state", "READY")
      .maybeSingle();
    if (content.error) throw new Error("Content lookup failed");
    const selected = versionId ?? content.data?.active_media_version_id;
    if (!content.data || !selected) return null;
    const [version, manifest] = await Promise.all([
      this.client
        .from("media_versions")
        .select("id,state,published_at,storage_access,r2_prefix,version_number,checksums")
        .eq("id", selected)
        .eq("content_id", contentId)
        .eq("state", "READY")
        .maybeSingle(),
      this.client
        .from("manifests")
        .select("path")
        .eq("media_version_id", selected)
        .eq("kind", "MASTER")
        .maybeSingle(),
    ]);
    if (version.error || manifest.error) throw new Error("Media lookup failed");
    if (!version.data || !manifest.data) return null;
    return {
      contentId: content.data.id,
      episodeId: null,
      mediaVersionId: version.data.id,
      contentState: content.data.state,
      state: version.data.state,
      publishedAt: version.data.published_at,
      access: content.data.access_level,
      storageAccess: version.data.storage_access,
      prefix: version.data.r2_prefix,
      versionNumber: version.data.version_number,
      checksums: version.data.checksums,
      manifestPath: manifest.data.path,
    };
  }
  async getEpisode(episodeId: string, versionId?: string): Promise<unknown | null> {
    IdSchema.parse(episodeId);
    if (versionId) IdSchema.parse(versionId);
    const episode = await this.client
      .from("episodes")
      .select("id,season_id,active_media_version_id")
      .eq("id", episodeId)
      .maybeSingle();
    if (episode.error) throw new Error("Episode lookup failed", { cause: episode.error });
    if (!episode.data) return null;
    const e = z
      .object({ id: IdSchema, season_id: IdSchema, active_media_version_id: IdSchema.nullable() })
      .parse(episode.data);
    const selected = versionId ?? e.active_media_version_id;
    if (!selected) return null;
    const season = await this.client
      .from("seasons")
      .select("show_id")
      .eq("id", e.season_id)
      .single();
    if (season.error) throw new Error("Season lookup failed", { cause: season.error });
    const s = z.object({ show_id: IdSchema }).parse(season.data);
    const show = await this.client.from("shows").select("content_id").eq("id", s.show_id).single();
    if (show.error) throw new Error("Show lookup failed", { cause: show.error });
    const sh = z.object({ content_id: IdSchema }).parse(show.data);
    const [content, version, manifest] = await Promise.all([
      this.client
        .from("content")
        .select("id,state,access_level")
        .eq("id", sh.content_id)
        .eq("state", "READY")
        .maybeSingle(),
      this.client
        .from("media_versions")
        .select(
          "id,episode_id,state,published_at,storage_access,r2_prefix,version_number,checksums",
        )
        .eq("id", selected)
        .eq("episode_id", episodeId)
        .eq("state", "READY")
        .maybeSingle(),
      this.client
        .from("manifests")
        .select("path")
        .eq("media_version_id", selected)
        .eq("kind", "MASTER")
        .maybeSingle(),
    ]);
    if (content.error || version.error || manifest.error) throw new Error("Media lookup failed");
    if (!content.data || !version.data || !manifest.data) return null;
    return {
      contentId: content.data.id,
      episodeId: version.data.episode_id,
      mediaVersionId: version.data.id,
      contentState: content.data.state,
      state: version.data.state,
      publishedAt: version.data.published_at,
      access: content.data.access_level,
      storageAccess: version.data.storage_access,
      prefix: version.data.r2_prefix,
      versionNumber: version.data.version_number,
      checksums: version.data.checksums,
      manifestPath: manifest.data.path,
    };
  }
}
