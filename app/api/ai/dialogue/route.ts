import { aiSession } from "@/lib/supabase/ai";
import { DialogueAssistantRequestSchema, dialogueAIRequest } from "@/features/ai/dialogue";
import { createAISurfaceHandler } from "@/services/security/AISurfaceRoute";
export const runtime = "nodejs";
export const POST = createAISurfaceHandler(
  DialogueAssistantRequestSchema,
  dialogueAIRequest,
  aiSession,
);
