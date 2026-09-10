import { z } from "zod";
import { readReadyCatalog } from "@/lib/supabase/catalog";
import { CatalogItemSchema } from "@/features/recommendations";
import { RecommendationSchema, recommendationCacheKey } from "@/features/recommendations";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

const QuerySchema = z
  .object({
    q: z.string().trim().max(200).default(""),
    mode: z.enum(["keyword", "semantic", "recommendations"]).default("keyword"),
  })
  .strict();
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const query = QuerySchema.parse({
      q: url.searchParams.get("q") ?? "",
      mode: url.searchParams.get("mode") ?? "keyword",
    });
    if (query.mode === "recommendations") {
      const caller = await createServerSupabaseClient();
      const auth = await caller.auth.getUser();
      if (!auth.data.user) return Response.json({ error: "Sign in required" }, { status: 401 });
      const service = createServiceSupabaseClient();
      const cached = await service
        .from("ai_cache")
        .select("response,expires_at")
        .eq("user_id", auth.data.user.id)
        .eq("cache_key", recommendationCacheKey(auth.data.user.id))
        .gt("expires_at", new Date().toISOString())
        .maybeSingle();
      if (!cached.error && cached.data)
        return Response.json({
          results: z.array(RecommendationSchema).parse(cached.data.response),
          mode: query.mode,
        });
    }
    const results = await readReadyCatalog(query.q);
    return Response.json({ results: z.array(CatalogItemSchema).parse(results), mode: query.mode });
  } catch {
    return Response.json({ error: "Catalog unavailable" }, { status: 503 });
  }
}
