import { aiSession } from "@/lib/supabase/ai";
import { RecapRequestSchema, recapAIRequest } from "@/features/ai/recap";
import { createAISurfaceHandler } from "@/services/security/AISurfaceRoute";
export const runtime = "nodejs";
export const POST = createAISurfaceHandler(RecapRequestSchema, recapAIRequest, aiSession);
