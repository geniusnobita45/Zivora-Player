import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
const PreferencesSchema = z
  .object({
    locale: z.string().min(2).max(20).optional(),
    autoplay: z.boolean().optional(),
    preferred_audio_language: z.string().max(20).nullable().optional(),
    preferred_subtitle_language: z.string().max(20).nullable().optional(),
    subtitles_enabled: z.boolean().optional(),
    auto_next: z.boolean().optional(),
    volume: z.number().min(0).max(1).optional(),
    muted: z.boolean().optional(),
    playback_rate: z.number().min(0.25).max(3).optional(),
    ai_enabled: z.boolean().optional(),
    maximum_cost_tier: z.enum(["low", "standard", "premium"]).optional(),
    preferred_language: z.string().max(20).nullable().optional(),
    allow_history: z.boolean().optional(),
    voice_enabled: z.boolean().optional(),
    auto_skip: z.boolean().optional(),
  })
  .strict();
async function user() {
  const client = await createServerSupabaseClient();
  const result = await client.auth.getUser();
  return result.data.user ? { client, user: result.data.user } : null;
}
export const runtime = "nodejs";
export async function GET() {
  const session = await user();
  if (!session) return Response.json({ error: "Sign in required" }, { status: 401 });
  const [base, playback, ai] = await Promise.all([
    session.client
      .from("preferences")
      .select(
        "locale,autoplay,preferred_audio_language,preferred_subtitle_language,subtitles_enabled,settings",
      )
      .eq("user_id", session.user.id)
      .maybeSingle(),
    session.client
      .from("playback_preferences")
      .select("auto_next,volume,muted,playback_rate")
      .eq("user_id", session.user.id)
      .maybeSingle(),
    session.client
      .from("ai_preferences")
      .select("enabled,maximum_cost_tier,preferred_language,allow_history,settings")
      .eq("user_id", session.user.id)
      .maybeSingle(),
  ]);
  if (base.error || playback.error || ai.error)
    return Response.json({ error: "Preferences unavailable" }, { status: 503 });
  return Response.json({ base: base.data, playback: playback.data, ai: ai.data });
}
export async function PATCH(request: Request) {
  const session = await user();
  if (!session) return Response.json({ error: "Sign in required" }, { status: 401 });
  try {
    const input = PreferencesSchema.parse(await request.json());
    const baseKeys = [
      "locale",
      "autoplay",
      "preferred_audio_language",
      "preferred_subtitle_language",
      "subtitles_enabled",
    ] as const;
    const playbackKeys = ["auto_next", "volume", "muted", "playback_rate"] as const;
    const base = Object.fromEntries(
      baseKeys.filter((key) => key in input).map((key) => [key, input[key]]),
    );
    const playback = Object.fromEntries(
      playbackKeys.filter((key) => key in input).map((key) => [key, input[key]]),
    );
    const ai = {
      ...(input.ai_enabled === undefined ? {} : { enabled: input.ai_enabled }),
      ...(input.maximum_cost_tier === undefined
        ? {}
        : { maximum_cost_tier: input.maximum_cost_tier }),
      ...(input.preferred_language === undefined
        ? {}
        : { preferred_language: input.preferred_language }),
      ...(input.allow_history === undefined ? {} : { allow_history: input.allow_history }),
      settings: {
        ...(input.voice_enabled === undefined ? {} : { voice_enabled: input.voice_enabled }),
        ...(input.auto_skip === undefined ? {} : { auto_skip: input.auto_skip }),
      },
    };
    if (Object.keys(base).length) {
      const result = await session.client
        .from("preferences")
        .upsert({ user_id: session.user.id, ...base } as never);
      if (result.error) throw result.error;
    }
    if (Object.keys(playback).length) {
      const result = await session.client
        .from("playback_preferences")
        .upsert({ user_id: session.user.id, ...playback } as never);
      if (result.error) throw result.error;
    }
    if (Object.keys(ai).length > 1) {
      const result = await session.client
        .from("ai_preferences")
        .upsert({ user_id: session.user.id, ...ai } as never);
      if (result.error) throw result.error;
    }
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "Invalid preferences" }, { status: 400 });
  }
}
