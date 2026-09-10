import { aiSession } from "@/lib/supabase/ai";
import { createAIStreamHandler } from "@/services/security/AIRoute";
export const runtime = "nodejs";
export const POST = createAIStreamHandler(aiSession);
