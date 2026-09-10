import { z } from "zod";
import { AccessLevelSchema, versionPrefix, VersionPrefixSchema } from "@/lib/r2/paths";

export const VersionTargetSchema = z
  .object({
    contentId: z.string().uuid(),
    episodeId: z.string().uuid().nullable().default(null),
  })
  .strict();
export type VersionTarget = z.infer<typeof VersionTargetSchema>;
export const AllocatedVersionSchema = z
  .object({
    id: z.string().uuid(),
    contentId: z.string().uuid(),
    episodeId: z.string().uuid().nullable(),
    versionNumber: z.number().int().positive(),
    prefix: VersionPrefixSchema,
    access: AccessLevelSchema,
  })
  .strict();
export type AllocatedVersion = z.infer<typeof AllocatedVersionSchema>;
export interface VersionAllocator {
  reserve(target: VersionTarget): Promise<unknown>;
}

export class VersionManager {
  constructor(private readonly allocator: VersionAllocator) {}

  async allocate(input: unknown): Promise<AllocatedVersion> {
    const target = VersionTargetSchema.parse(input);
    const version = AllocatedVersionSchema.parse(await this.allocator.reserve(target));
    if (
      version.contentId !== target.contentId ||
      version.episodeId !== target.episodeId ||
      version.prefix !== versionPrefix(target.contentId, target.episodeId, version.versionNumber)
    ) {
      throw new Error("Database returned an inconsistent media version reservation");
    }
    return version;
  }
}
