import { z } from "zod";
import { ObjectPathSchema } from "@/lib/r2/paths";

export const PlaybackRequestSchema = z
  .discriminatedUnion("action", [
    z
      .object({
        action: z.literal("authorize"),
        episodeId: z.string().uuid().optional(),
        contentId: z.string().uuid().optional(),
      })
      .strict(),
    z
      .object({
        action: z.literal("catalog"),
        contentId: z.string().uuid(),
        episodeId: z.string().uuid().optional(),
      })
      .strict(),
    z.object({ action: z.literal("renew"), token: z.string().min(1).max(4096) }).strict(),
    z
      .object({
        action: z.literal("sign"),
        token: z.string().min(1).max(4096),
        paths: z.array(ObjectPathSchema).min(1).max(64),
      })
      .strict(),
  ])
  .superRefine((value, context) => {
    if (value.action === "authorize" && Boolean(value.episodeId) === Boolean(value.contentId))
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Authorize exactly one episode or content ID",
      });
  });
const Common = {
  contentId: z.string().uuid(),
  episodeId: z.string().uuid().nullable(),
  mediaVersionId: z.string().uuid(),
  manifestUrl: z.string().url(),
  objectBaseUrl: z.string().url(),
};
export const PlaybackGrantSchema = z.discriminatedUnion("access", [
  z
    .object({ ...Common, access: z.literal("public"), token: z.null(), expiresAt: z.null() })
    .strict(),
  z
    .object({
      ...Common,
      access: z.literal("private"),
      token: z.string().min(1).max(4096),
      expiresAt: z.number().int().positive(),
    })
    .strict(),
]);
export type PlaybackGrant = z.infer<typeof PlaybackGrantSchema>;
export const SignedObjectsSchema = z
  .object({
    urls: z.record(ObjectPathSchema, z.string().url()),
    expiresAt: z.number().int().positive(),
  })
  .strict();
