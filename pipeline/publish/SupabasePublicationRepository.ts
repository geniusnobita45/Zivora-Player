import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database, Json } from "@/lib/supabase/types";
import type { VersionTarget, VersionAllocator } from "./VersionManager";
import type { PublicationRepository, MediaRegistration } from "./Publisher";

export class SupabasePublicationRepository implements VersionAllocator, PublicationRepository {
  constructor(private readonly client: SupabaseClient<Database>) {}
  async reserve(target: VersionTarget): Promise<unknown> {
    const { data, error } = await this.client.rpc("reserve_media_version", {
      p_content_id: target.contentId,
      p_episode_id: target.episodeId,
    });
    if (error) throw new Error("Version reservation failed", { cause: error });
    return data;
  }
  async register(versionId: string, media: MediaRegistration): Promise<void> {
    const { error } = await this.client.rpc("register_media_version", {
      version_id: z.string().uuid().parse(versionId),
      media: JSON.parse(JSON.stringify(media)) as Json,
    });
    if (error) throw new Error("Media registration failed", { cause: error });
  }
  async markReady(versionId: string): Promise<void> {
    const { error } = await this.client.rpc("ready_media_version", {
      version_id: z.string().uuid().parse(versionId),
    });
    if (error) throw new Error("Media READY validation failed", { cause: error });
  }
  async fail(versionId: string): Promise<void> {
    const { error } = await this.client.rpc("fail_media_version", {
      version_id: z.string().uuid().parse(versionId),
    });
    if (error) throw new Error("Failed to record publication failure", { cause: error });
  }
  async publish(versionId: string): Promise<string> {
    const { data, error } = await this.client.rpc("publish_media_version", {
      version_id: z.string().uuid().parse(versionId),
    });
    if (error) throw new Error("Media activation failed", { cause: error });
    return z.string().uuid().parse(data);
  }
  async rollback(parentId: string): Promise<string> {
    const { data, error } = await this.client.rpc("rollback_media_version", {
      content_or_episode_id: z.string().uuid().parse(parentId),
    });
    if (error) throw new Error("Media rollback failed", { cause: error });
    return z.string().uuid().parse(data);
  }
}
