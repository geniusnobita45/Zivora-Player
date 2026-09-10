import { aiSession } from "@/lib/supabase/ai";
import { createAIHandler } from "@/services/security/AIRoute";
export const runtime = "nodejs";
export const POST = createAIHandler(aiSession);
