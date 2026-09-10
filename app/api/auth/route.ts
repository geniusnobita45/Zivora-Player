import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
const AuthBodySchema = z
  .object({
    action: z.enum(["sign_in", "sign_up", "sign_out"]),
    email: z.string().email().optional(),
    password: z.string().min(8).max(200).optional(),
  })
  .strict();
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const input = AuthBodySchema.parse(await request.json());
    const client = await createServerSupabaseClient();
    if (input.action === "sign_out") {
      const result = await client.auth.signOut();
      if (result.error) throw result.error;
      return Response.json({ ok: true });
    }
    if (!input.email || !input.password)
      return Response.json({ error: "Email and password are required" }, { status: 400 });
    const result =
      input.action === "sign_in"
        ? await client.auth.signInWithPassword({ email: input.email, password: input.password })
        : await client.auth.signUp({ email: input.email, password: input.password });
    if (result.error || !result.data.user)
      return Response.json({ error: "Authentication failed" }, { status: 401 });
    const service = createServiceSupabaseClient();
    await service.from("profiles").upsert({ id: result.data.user.id });
    await service.from("preferences").upsert({ user_id: result.data.user.id });
    await service.from("playback_preferences").upsert({ user_id: result.data.user.id });
    await service.from("ai_preferences").upsert({ user_id: result.data.user.id });
    return Response.json({ userId: result.data.user.id });
  } catch {
    return Response.json({ error: "Invalid authentication request" }, { status: 400 });
  }
}
