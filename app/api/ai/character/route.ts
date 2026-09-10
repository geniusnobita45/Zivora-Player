import { aiSession } from "@/lib/supabase/ai";
import { CharacterAssistantRequestSchema, characterAIRequest } from "@/features/ai/characters";
import { createAISurfaceHandler } from "@/services/security/AISurfaceRoute";
export const runtime = "nodejs";
export const POST = createAISurfaceHandler(
  CharacterAssistantRequestSchema,
  characterAIRequest,
  aiSession,
);
