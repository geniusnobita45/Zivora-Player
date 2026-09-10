import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
  AccessLevelSchema,
  ObjectPathSchema,
  Sha256Schema,
  VersionPrefixSchema,
  objectKey,
  versionPrefix,
} from "@/lib/r2/paths";
import {
  PlaybackGrantSchema,
  SignedObjectsSchema,
  type PlaybackGrant,
} from "@/types/playbackAuthorization";

/** Only pass users returned by Supabase auth.getUser(), never client-supplied claims. */
export const VerifiedUserSchema = z
  .object({
    id: z.string().uuid(),
    app_metadata: z
      .object({ content_ids: z.array(z.string().uuid()).default([]) })
      .passthrough()
      .default({}),
  })
  .passthrough();
export type VerifiedUser = z.infer<typeof VerifiedUserSchema>;
export const PlaybackMediaSchema = z
  .object({
    contentId: z.string().uuid(),
    episodeId: z.string().uuid().nullable(),
    mediaVersionId: z.string().uuid(),
    contentState: z.literal("READY"),
    state: z.literal("READY"),
    publishedAt: z.string().datetime({ offset: true }),
    access: AccessLevelSchema,
    storageAccess: AccessLevelSchema,
    prefix: VersionPrefixSchema,
    versionNumber: z.number().int().positive(),
    manifestPath: ObjectPathSchema,
    checksums: z.record(ObjectPathSchema, Sha256Schema),
  })
  .strict();
type PlaybackMedia = z.infer<typeof PlaybackMediaSchema>;
export interface PlaybackCatalog {
  getEpisode(episodeId: string, versionId?: string): Promise<unknown | null>;
  getContent?(contentId: string, versionId?: string): Promise<unknown | null>;
}
export interface PlaybackUrlSigner {
  sign(key: string, expiresIn: number): Promise<string>;
  privateUrl(key: string): string;
  publicUrl(key: string): string;
}
export class PlaybackAuthorizationError extends Error {
  constructor(
    readonly status: 401 | 403 | 404,
    message: string,
  ) {
    super(message);
    this.name = "PlaybackAuthorizationError";
  }
}
const ClaimsSchema = z
  .object({
    v: z.literal(1),
    aud: z.literal("zivora-playback"),
    sub: z.string().uuid(),
    contentId: z.string().uuid(),
    episodeId: z.string().uuid().nullable(),
    mediaVersionId: z.string().uuid(),
    iat: z.number().int().nonnegative(),
    exp: z.number().int().positive(),
    jti: z.string().uuid(),
  })
  .strict();
type Claims = z.infer<typeof ClaimsSchema>;

export class PlaybackAuthorization {
  private readonly secret: string;
  constructor(
    private readonly catalog: PlaybackCatalog,
    private readonly urls: PlaybackUrlSigner,
    secret: string,
    private readonly now: () => number = Date.now,
    private readonly entitled: (
      user: VerifiedUser,
      contentId: string,
    ) => boolean | Promise<boolean> = (user, contentId) =>
      user.app_metadata.content_ids.includes(contentId),
  ) {
    this.secret = z.string().min(32).parse(secret);
  }
  private user(input: unknown): VerifiedUser {
    const result = VerifiedUserSchema.safeParse(input);
    if (!result.success) throw new PlaybackAuthorizationError(401, "Authentication required");
    return result.data;
  }
  private async requireEntitlement(user: VerifiedUser, contentId: string) {
    if (!(await this.entitled(user, contentId)))
      throw new PlaybackAuthorizationError(403, "Playback is not entitled");
  }
  private async media(
    episodeId: string | null,
    versionId?: string,
    contentId?: string,
  ): Promise<PlaybackMedia> {
    const result = PlaybackMediaSchema.safeParse(
      episodeId
        ? await this.catalog.getEpisode(episodeId, versionId)
        : contentId
          ? await this.catalog.getContent?.(contentId, versionId)
          : null,
    );
    if (!result.success) throw new PlaybackAuthorizationError(404, "Playable episode not found");
    const media = result.data;
    if (
      media.episodeId !== episodeId ||
      (contentId && media.contentId !== contentId) ||
      (versionId && media.mediaVersionId !== versionId) ||
      media.access !== media.storageAccess ||
      media.prefix !== versionPrefix(media.contentId, media.episodeId, media.versionNumber) ||
      !Object.hasOwn(media.checksums, media.manifestPath)
    ) {
      throw new PlaybackAuthorizationError(404, "Playable episode not found");
    }
    return media;
  }
  private mac(payload: string) {
    return createHmac("sha256", this.secret).update(payload).digest();
  }
  private verify(input: unknown, user: VerifiedUser): Claims {
    try {
      const token = z
        .string()
        .max(4096)
        .regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
        .parse(input);
      const [payload, signature] = token.split(".");
      const actual = Buffer.from(signature, "base64url");
      const expected = this.mac(payload);
      if (
        actual.toString("base64url") !== signature ||
        actual.length !== expected.length ||
        !timingSafeEqual(actual, expected)
      )
        throw new Error("signature");
      const claims = ClaimsSchema.parse(
        JSON.parse(Buffer.from(payload, "base64url").toString("utf8")),
      );
      const now = Math.floor(this.now() / 1000);
      if (
        claims.sub !== user.id ||
        claims.exp <= now ||
        claims.iat > now ||
        claims.exp - claims.iat !== 600
      )
        throw new Error("claims");
      return claims;
    } catch {
      throw new PlaybackAuthorizationError(401, "Invalid or expired playback token");
    }
  }
  private async grant(media: PlaybackMedia, user?: VerifiedUser): Promise<PlaybackGrant> {
    const common = {
      contentId: media.contentId,
      episodeId: media.episodeId,
      mediaVersionId: media.mediaVersionId,
    };
    const key = objectKey(media.prefix, media.manifestPath);
    if (media.access === "public")
      return PlaybackGrantSchema.parse({
        ...common,
        access: "public",
        token: null,
        expiresAt: null,
        manifestUrl: this.urls.publicUrl(key),
        objectBaseUrl: this.urls.publicUrl(objectKey(media.prefix, "base")).slice(0, -4),
      });
    if (!user) throw new PlaybackAuthorizationError(401, "Authentication required");
    const iat = Math.floor(this.now() / 1000);
    const claims: Claims = {
      ...common,
      v: 1,
      aud: "zivora-playback",
      sub: user.id,
      iat,
      exp: iat + 600,
      jti: randomUUID(),
    };
    const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
    return PlaybackGrantSchema.parse({
      ...common,
      access: "private",
      token: `${payload}.${this.mac(payload).toString("base64url")}`,
      expiresAt: claims.exp * 1000,
      manifestUrl: await this.urls.sign(key, 600),
      objectBaseUrl: this.urls.privateUrl(objectKey(media.prefix, "base")).slice(0, -4),
    });
  }
  async authorize(userInput: unknown, episodeInput: unknown): Promise<PlaybackGrant> {
    const media = await this.media(z.string().uuid().parse(episodeInput));
    if (media.access === "public") return this.grant(media);
    const user = this.user(userInput);
    await this.requireEntitlement(user, media.contentId);
    return this.grant(media, user);
  }
  async authorizeContent(userInput: unknown, contentInput: unknown): Promise<PlaybackGrant> {
    const media = await this.media(null, undefined, z.string().uuid().parse(contentInput));
    if (media.access === "public") return this.grant(media);
    const user = this.user(userInput);
    await this.requireEntitlement(user, media.contentId);
    return this.grant(media, user);
  }
  async renew(userInput: unknown, tokenInput: unknown): Promise<PlaybackGrant> {
    const user = this.user(userInput);
    const claims = this.verify(tokenInput, user);
    const media = await this.media(claims.episodeId, claims.mediaVersionId, claims.contentId);
    if (media.contentId !== claims.contentId || media.access !== "private")
      throw new PlaybackAuthorizationError(403, "Playback version changed");
    await this.requireEntitlement(user, media.contentId);
    return this.grant(media, user);
  }
  async signObjects(userInput: unknown, tokenInput: unknown, pathsInput: unknown) {
    const user = this.user(userInput);
    const claims = this.verify(tokenInput, user);
    const paths = z.array(ObjectPathSchema).min(1).max(64).parse(pathsInput);
    const media = await this.media(claims.episodeId, claims.mediaVersionId, claims.contentId);
    if (
      media.contentId !== claims.contentId ||
      media.access !== "private" ||
      paths.some((path) => !Object.hasOwn(media.checksums, path))
    )
      throw new PlaybackAuthorizationError(403, "Object is outside this playback version");
    await this.requireEntitlement(user, media.contentId);
    const expiresIn = claims.exp - Math.floor(this.now() / 1000);
    if (expiresIn <= 0) throw new PlaybackAuthorizationError(401, "Expired playback token");
    const entries = await Promise.all(
      [...new Set(paths)].map(async (path) => [
        path,
        await this.urls.sign(objectKey(media.prefix, path), expiresIn),
      ]),
    );
    return SignedObjectsSchema.parse({
      urls: Object.fromEntries(entries),
      expiresAt: claims.exp * 1000,
    });
  }
}
