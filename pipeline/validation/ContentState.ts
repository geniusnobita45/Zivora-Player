import { z } from "zod";
export const ContentStateSchema = z.enum([
  "UPLOADED",
  "PROCESSING",
  "AI_PROCESSING",
  "VALIDATING",
  "READY",
  "FAILED",
]);
export type ContentState = z.infer<typeof ContentStateSchema>;
const transitions: Record<ContentState, ContentState[]> = {
  UPLOADED: ["PROCESSING", "FAILED"],
  PROCESSING: ["AI_PROCESSING", "FAILED"],
  AI_PROCESSING: ["VALIDATING", "FAILED"],
  VALIDATING: ["READY", "FAILED"],
  READY: [],
  FAILED: ["PROCESSING"],
};
export function canTransition(from: ContentState, to: ContentState) {
  return transitions[from].includes(to);
}
