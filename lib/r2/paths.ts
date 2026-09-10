import { z } from "zod";

// Canonical relative keys only: no URL decoding, traversal, query strings or aliases.
export const ObjectPathSchema = z
  .string()
  .min(1)
  .max(1024)
  .refine(
    (value) => value.split("/").every((part) => /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/.test(part)),
    "Expected a canonical relative object path",
  );
export const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
export const AccessLevelSchema = z.enum(["private", "public"]);
export const VersionPrefixSchema = z
  .string()
  .regex(/^media\/[0-9a-f-]{36}\/(?:[0-9a-f-]{36}\/)?v[1-9][0-9]*\/$/);

export function versionPrefix(
  contentId: string,
  episodeId: string | null,
  version: number,
): string {
  const content = z.string().uuid().parse(contentId).toLowerCase();
  const episode = episodeId === null ? null : z.string().uuid().parse(episodeId).toLowerCase();
  const number = z.number().int().positive().safe().parse(version);
  return `media/${content}/${episode ? `${episode}/` : ""}v${number}/`;
}

export function objectKey(prefix: string, path: string): string {
  return `${VersionPrefixSchema.parse(prefix)}${ObjectPathSchema.parse(path)}`;
}

export function resolvePlaylistReference(playlist: string, reference: string): string {
  ObjectPathSchema.parse(playlist);
  ObjectPathSchema.parse(reference);
  const directory = playlist.includes("/") ? playlist.slice(0, playlist.lastIndexOf("/") + 1) : "";
  return ObjectPathSchema.parse(`${directory}${reference}`);
}
