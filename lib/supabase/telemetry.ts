import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { TelemetryBatchSchema } from "@/types/telemetry";
import type { Database } from "./types";

const ServerIdentitySchema = z.object({ id: z.string().uuid() }).strict();

export class TelemetryRepository {
  constructor(private readonly client: SupabaseClient<Database>) {}
  async ingest(input: unknown, authenticatedUserId: string | null): Promise<void> {
    const batch = TelemetryBatchSchema.parse(input);
    const userId =
      authenticatedUserId === null
        ? null
        : ServerIdentitySchema.parse({ id: authenticatedUserId }).id;
    const events: Database["public"]["Tables"]["playback_events"]["Insert"][] = [];
    const errors: Database["public"]["Tables"]["playback_errors"]["Insert"][] = [];
    const buffers: Database["public"]["Tables"]["buffering_events"]["Insert"][] = [];
    const seeks: Database["public"]["Tables"]["seek_events"]["Insert"][] = [];
    const qualities: Database["public"]["Tables"]["quality_events"]["Insert"][] = [];
    for (const session of batch.sessions) {
      const context = session.context;
      for (const event of session.events) {
        const common = {
          session_id: context.sessionId,
          user_id: userId,
          content_id: context.contentId,
          episode_id: context.episodeId,
          media_version_id: context.mediaVersionId,
          occurred_at: event.at,
          device: context.device,
          browser: context.browser,
          network: context.network,
        };
        events.push({
          ...common,
          event_type: event.type,
          position_s: event.positionS,
          startup_ms: event.startupMs ?? null,
          watch_duration_ms: event.watchDurationMs ?? null,
          total_buffer_ms: event.totalBufferMs ?? null,
          completion_percentage: event.completionPercentage ?? null,
          failed_requests: event.failedRequests ?? null,
          os: context.os,
          payload: {},
        });
        if (event.error)
          errors.push({
            ...common,
            code: event.error.code,
            category: event.error.category,
            fatal: event.error.fatal,
            recoverable: event.error.recoverable,
          });
        if (event.bufferDurationMs != null)
          buffers.push({
            ...common,
            position_s: event.positionS,
            duration_ms: event.bufferDurationMs,
          });
        if (event.seekFromS != null && event.seekToS != null)
          seeks.push({
            ...common,
            from_position_s: event.seekFromS,
            to_position_s: event.seekToS,
            latency_ms: event.seekLatencyMs ?? null,
          });
        if (event.renditionId)
          qualities.push({
            ...common,
            rendition_id: event.renditionId,
            rendition_height: event.renditionHeight ?? null,
            rendition_bitrate: event.renditionBitrate ?? null,
            bandwidth_estimate: event.bandwidthEstimate ?? null,
          });
      }
    }
    const writes = [
      this.client.from("playback_events").insert(events),
      errors.length
        ? this.client.from("playback_errors").insert(errors)
        : Promise.resolve({ error: null }),
      buffers.length
        ? this.client.from("buffering_events").insert(buffers)
        : Promise.resolve({ error: null }),
      seeks.length
        ? this.client.from("seek_events").insert(seeks)
        : Promise.resolve({ error: null }),
      qualities.length
        ? this.client.from("quality_events").insert(qualities)
        : Promise.resolve({ error: null }),
    ];
    const results = await Promise.all(writes);
    if (results.some((result) => result.error)) throw new Error("Telemetry ingest failed");
  }
}
