import { aiSession } from "@/lib/supabase/ai";
import { SceneSearchRequestSchema, sceneSearchAIRequest } from "@/features/ai/scene-search";
import { createAISurfaceHandler } from "@/services/security/AISurfaceRoute";
export const runtime = "nodejs";
export const POST = createAISurfaceHandler(
  SceneSearchRequestSchema,
  sceneSearchAIRequest,
  aiSession,
);
