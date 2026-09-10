import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { PlaybackMetricsSchema, type PlaybackMetrics } from "@/services/telemetry/PlaybackMetrics";
import type { Database } from "./types";

export class AnalyticsRepository {
  constructor(private readonly client: SupabaseClient<Database>) {}
  async read(): Promise<PlaybackMetrics> {
    const [startup, seek, rebuffer, errors, quality] = await Promise.all([
      this.client.from("analytics_video_startup_time").select("samples,p50_ms,p95_ms").single(),
      this.client.from("analytics_seek_response_time").select("samples,p50_ms,p95_ms").single(),
      this.client.from("analytics_rebuffer_ratio").select("samples,ratio").single(),
      this.client
        .from("analytics_playback_error_rate")
        .select("sessions,failed_sessions,error_rate")
        .single(),
      this.client
        .from("analytics_average_selected_quality")
        .select(
          "device,browser,network,rendition_id,rendition_height,rendition_bitrate,selections,average_bandwidth_estimate",
        )
        .order("selections", { ascending: false })
        .limit(100),
    ]);
    if (startup.error || seek.error || rebuffer.error || errors.error || quality.error)
      throw new Error("Analytics query failed");
    return PlaybackMetricsSchema.parse({
      startup: startup.data,
      seek: seek.data,
      rebuffer: rebuffer.data,
      errors: errors.data,
      quality: quality.data,
    });
  }
}
