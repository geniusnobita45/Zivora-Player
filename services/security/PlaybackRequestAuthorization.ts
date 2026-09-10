import { z } from "zod";
import { ObjectPathSchema } from "@/lib/r2/paths";
import {
  PlaybackGrantSchema,
  PlaybackRequestSchema,
  SignedObjectsSchema,
  type PlaybackGrant,
} from "@/types/playbackAuthorization";

export interface PlaybackRequestContext {
  type: "manifest" | "segment" | "license" | "other";
  uris: readonly string[];
}
export interface RequestAuthorization {
  uris: string[];
}
type Transport = (body: unknown) => Promise<unknown>;

/** Metadata-only transport. Shaka downloads every authorized object from R2 itself. */
export async function playbackTransport(body: unknown, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch("/api/playback", {
    method: "POST",
    signal,
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(PlaybackRequestSchema.parse(body)),
  });
  if (!response.ok) throw new Error(`Playback authorization failed (${response.status})`);
  return response.json();
}

/** Per-session URL authorization; future license authorization remains a separate adapter hook. */
export class PlaybackRequestAuthorization {
  private grant: PlaybackGrant;
  private renewal: Promise<void> | undefined;
  private readonly cache = new Map<string, { url: string; expiresAt: number }>();
  constructor(
    grant: unknown,
    private readonly transport: Transport = playbackTransport,
    private readonly now: () => number = Date.now,
  ) {
    this.grant = PlaybackGrantSchema.parse(grant);
    this.validateBase(this.grant);
    const path = this.path(this.grant.manifestUrl);
    if (this.grant.access === "private")
      this.cache.set(path, { url: this.grant.manifestUrl, expiresAt: this.grant.expiresAt });
  }
  private validateBase(grant: PlaybackGrant) {
    const base = new URL(grant.objectBaseUrl);
    if (
      base.protocol !== "https:" ||
      base.search ||
      base.hash ||
      base.username ||
      base.password ||
      !base.pathname.endsWith("/")
    )
      throw new Error("Invalid playback object base");
  }
  private path(uri: string): string {
    const url = new URL(z.string().url().parse(uri));
    const base = new URL(this.grant.objectBaseUrl);
    if (
      url.origin !== base.origin ||
      !url.pathname.startsWith(base.pathname) ||
      url.username ||
      url.password ||
      url.hash
    )
      throw new Error("Playback request is outside the authorized origin/version");
    return ObjectPathSchema.parse(url.pathname.slice(base.pathname.length));
  }
  private async refresh(): Promise<void> {
    if (this.grant.access === "public" || this.now() < this.grant.expiresAt - 60_000) return;
    if (!this.renewal) {
      const previous = this.grant;
      this.renewal = (async () => {
        const next = PlaybackGrantSchema.parse(
          await this.transport({ action: "renew", token: previous.token }),
        );
        this.validateBase(next);
        if (
          next.access !== "private" ||
          next.mediaVersionId !== previous.mediaVersionId ||
          next.contentId !== previous.contentId ||
          next.episodeId !== previous.episodeId ||
          next.objectBaseUrl !== previous.objectBaseUrl ||
          next.expiresAt <= this.now() + 60_000
        )
          throw new Error("Invalid playback renewal");
        this.path(next.manifestUrl);
        this.grant = next;
        this.cache.clear();
      })().finally(() => {
        this.renewal = undefined;
      });
    }
    return this.renewal;
  }
  readonly authorizeRequest = async (
    request: PlaybackRequestContext,
  ): Promise<RequestAuthorization | undefined> => {
    // DRM license URIs and headers are deliberately not signed with storage credentials.
    if (request.type === "license" || this.grant.access === "public") return undefined;
    const uris = z.array(z.string().url()).min(1).max(64).parse(request.uris);
    const paths = uris.map((uri) => this.path(uri));
    await this.refresh();
    const missing = [
      ...new Set(
        paths.filter((path) => (this.cache.get(path)?.expiresAt ?? 0) <= this.now() + 30_000),
      ),
    ];
    if (missing.length) {
      const signed = SignedObjectsSchema.parse(
        await this.transport({ action: "sign", token: this.grant.token, paths: missing }),
      );
      if (
        this.grant.access !== "private" ||
        signed.expiresAt > this.grant.expiresAt ||
        signed.expiresAt <= this.now() + 30_000 ||
        Object.keys(signed.urls).length !== missing.length
      )
        throw new Error("Invalid signed URL lifetime/inventory");
      for (const path of missing) {
        const url = signed.urls[path];
        if (!url || this.path(url) !== path) throw new Error("Signer returned a different object");
        this.cache.set(path, { url, expiresAt: signed.expiresAt });
      }
    }
    const result = { uris: paths.map((path) => this.cache.get(path)!.url) };
    // Bound memory for multi-hour media. Eviction never changes playback state.
    while (this.cache.size > 256) this.cache.delete(this.cache.keys().next().value!);
    return result;
  };
}
