import { z } from "zod";
export const CommandSourceSchema = z.enum(["ui", "keyboard", "gesture", "ai"]);
export type CommandSource = z.infer<typeof CommandSourceSchema>;
export const LanguageSchema = z
  .string()
  .trim()
  .regex(/^[a-zA-Z]{2,8}(?:-[a-zA-Z0-9]{1,8})*$/)
  .max(64);
const common = {
  source: CommandSourceSchema,
  reason: z.string().trim().max(500).optional(),
  issuedAt: z.number().int().nonnegative().finite(),
};
export const PlayerCommandSchema = z.discriminatedUnion("type", [
  z.object({ ...common, type: z.literal("PLAY") }).strict(),
  z.object({ ...common, type: z.literal("PAUSE") }).strict(),
  z.object({ ...common, type: z.literal("TOGGLE_PLAY") }).strict(),
  z.object({ ...common, type: z.literal("SEEK_TO"), seconds: z.number().finite() }).strict(),
  z.object({ ...common, type: z.literal("SEEK_BY"), delta: z.number().finite() }).strict(),
  z
    .object({ ...common, type: z.literal("SET_VOLUME"), level: z.number().finite().min(0).max(1) })
    .strict(),
  z.object({ ...common, type: z.literal("SET_MUTED"), muted: z.boolean() }).strict(),
  z
    .object({ ...common, type: z.literal("SET_RATE"), rate: z.number().finite().min(0.25).max(3) })
    .strict(),
  z
    .object({
      ...common,
      type: z.literal("SELECT_QUALITY"),
      id: z
        .string()
        .trim()
        .min(1)
        .max(128)
        .refine((id) => id !== "auto", "Use ENABLE_AUTO_QUALITY"),
    })
    .strict(),
  z.object({ ...common, type: z.literal("ENABLE_AUTO_QUALITY") }).strict(),
  z.object({ ...common, type: z.literal("SELECT_AUDIO"), lang: LanguageSchema }).strict(),
  z
    .object({
      ...common,
      type: z.literal("SELECT_SUBTITLE"),
      lang: LanguageSchema.nullable(),
      kind: z.enum(["original", "literal", "natural"]).optional(),
    })
    .strict(),
  z.object({ ...common, type: z.literal("TOGGLE_FULLSCREEN") }).strict(),
  z.object({ ...common, type: z.literal("TOGGLE_PIP") }).strict(),
  z
    .object({
      ...common,
      type: z.literal("SKIP_SEGMENT"),
      segmentId: z.string().trim().min(1).max(128),
    })
    .strict(),
]);
export type PlayerCommand = z.infer<typeof PlayerCommandSchema>;
export type CommandMeta = { source?: CommandSource; reason?: string };
export const SkipSegmentSchema = z
  .object({
    id: z.string().min(1).max(128),
    start: z.number().finite().nonnegative(),
    end: z.number().finite().nonnegative(),
  })
  .strict()
  .refine((segment) => segment.end > segment.start, "Segment end must follow start");
export type SkipSegment = z.infer<typeof SkipSegmentSchema>;
