import { z } from "zod";
export const R2ManifestSchema = z.object({
  url: z.string().url(),
  version: z.number().int().positive(),
  immutableHash: z.string().min(1),
});
export type R2Manifest = z.infer<typeof R2ManifestSchema>;
