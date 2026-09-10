import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import { TelemetryRepository } from "@/lib/supabase/telemetry";
import { createTelemetryHandler } from "@/services/telemetry/TelemetryRoute";

export const runtime = "nodejs";
export const POST = createTelemetryHandler({
  sink: new TelemetryRepository(createServiceSupabaseClient()),
  authenticate: async (request) => {
    const authorization = request.headers.get("authorization");
    if (!authorization && !request.headers.get("cookie")) return null;
    const bearer = authorization ? /^Bearer ([A-Za-z0-9._-]{1,8192})$/.exec(authorization) : null;
    if (authorization && !bearer) return null;
    const client = await createServerSupabaseClient(bearer?.[1]);
    const { data, error } = await client.auth.getUser(bearer?.[1]);
    return error || !data.user ? null : data.user;
  },
});
