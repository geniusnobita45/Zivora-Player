import { z } from "zod";
import { ManifestUrlSchema } from "@/core/player/PlayerConfig";
import { TypedEventEmitter } from "@/core/player/PlayerEvents";
export const SignedManifestSchema = z
  .object({
    url: ManifestUrlSchema,
    expiresAt: z.number().finite().int().positive(),
  })
  .strict();
export type SignedManifest = z.infer<typeof SignedManifestSchema>;
export interface ManifestHealth {
  healthy: boolean;
  status: number | null;
  checkedAt: number;
  reason?: "unloaded" | "expired" | "http" | "network";
}
export interface ManifestManagerOptions {
  resolve: (signal: AbortSignal) => Promise<unknown>;
  fetch?: typeof fetch;
  now?: () => number;
  refreshAheadMs?: number;
  retryMs?: number;
  timeoutMs?: number;
}
/** Manages authorization metadata only. Health requests are HEADs directly to the media origin. */
export class ManifestManager extends TypedEventEmitter<{
  refreshed: SignedManifest;
  refresherror: unknown;
}> {
  private current: SignedManifest | null = null;
  private pending: Promise<SignedManifest> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private readonly requests = new Set<AbortController>();
  private readonly now: () => number;
  private readonly fetcher: typeof fetch;
  private readonly refreshAhead: number;
  private readonly retry: number;
  private readonly timeout: number;
  constructor(private readonly options: ManifestManagerOptions) {
    super();
    this.now = options.now ?? Date.now;
    this.fetcher = options.fetch ?? globalThis.fetch;
    this.refreshAhead = z
      .number()
      .finite()
      .positive()
      .parse(options.refreshAheadMs ?? 30_000);
    this.retry = z
      .number()
      .finite()
      .positive()
      .parse(options.retryMs ?? 5_000);
    this.timeout = z
      .number()
      .finite()
      .positive()
      .parse(options.timeoutMs ?? 5_000);
  }
  getSnapshot(): SignedManifest | null {
    return this.current ? { ...this.current } : null;
  }
  load(): Promise<SignedManifest> {
    return this.refresh();
  }
  refresh(): Promise<SignedManifest> {
    if (this.disposed) return Promise.reject(new Error("Manifest manager is destroyed"));
    if (this.pending) return this.pending;
    this.clearTimer();
    this.pending = this.withTimeout(this.options.resolve)
      .then((input) => {
        if (this.disposed) throw new Error("Manifest manager is destroyed");
        const manifest = SignedManifestSchema.parse(input);
        const now = z.number().finite().nonnegative().parse(this.now());
        if (manifest.expiresAt <= now) throw new Error("Signed manifest has expired");
        if (this.current) {
          const previous = new URL(this.current.url);
          const next = new URL(manifest.url);
          if (previous.origin !== next.origin || previous.pathname !== next.pathname)
            throw new Error("Renewal must retain the immutable media origin and path");
        }
        this.current = manifest;
        const ttl = manifest.expiresAt - now;
        this.schedule(ttl - Math.min(this.refreshAhead, ttl / 2));
        this.emit("refreshed", { ...manifest });
        return { ...manifest };
      })
      .catch((error: unknown) => {
        if (!this.disposed) {
          this.emit("refresherror", error);
          this.schedule(this.retry);
        }
        throw error;
      })
      .finally(() => {
        this.pending = null;
      });
    return this.pending;
  }
  private async withTimeout<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    this.requests.add(controller);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let rejectAbort: (() => void) | undefined;
    try {
      return await Promise.race([
        Promise.resolve().then(() => {
          if (controller.signal.aborted) throw new Error("Request aborted");
          return operation(controller.signal);
        }),
        new Promise<never>((_, reject) => {
          rejectAbort = () => reject(new Error("Manifest request aborted or timed out"));
          controller.signal.addEventListener("abort", rejectAbort, { once: true });
          timeout = setTimeout(() => controller.abort(), this.timeout);
        }),
      ]);
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
      if (rejectAbort) controller.signal.removeEventListener("abort", rejectAbort);
      this.requests.delete(controller);
    }
  }
  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
  private schedule(delay: number): void {
    this.clearTimer();
    if (!this.disposed)
      this.timer = setTimeout(
        () => {
          void this.refresh().catch(() => {});
        },
        Math.max(1, Math.min(delay, 2_147_483_647)),
      );
  }
  async healthCheck(): Promise<ManifestHealth> {
    const checkedAt = this.now();
    const manifest = this.current;
    if (!manifest || this.disposed)
      return { healthy: false, status: null, checkedAt, reason: "unloaded" };
    if (manifest.expiresAt <= checkedAt)
      return { healthy: false, status: null, checkedAt, reason: "expired" };
    try {
      const response = await this.withTimeout((signal) =>
        this.fetcher(manifest.url, {
          method: "HEAD",
          cache: "no-store",
          credentials: "omit",
          redirect: "error",
          signal,
        }),
      );
      const status = z.number().int().min(100).max(599).parse(response.status);
      return {
        healthy: status >= 200 && status < 300,
        status,
        checkedAt,
        ...(status >= 200 && status < 300 ? {} : { reason: "http" as const }),
      };
    } catch {
      return { healthy: false, status: null, checkedAt, reason: "network" };
    }
  }
  destroy(): void {
    this.disposed = true;
    this.clearTimer();
    this.requests.forEach((controller) => controller.abort());
    this.requests.clear();
    this.clear();
  }
}
