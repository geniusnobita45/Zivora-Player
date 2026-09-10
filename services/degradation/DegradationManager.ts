import { z, type ZodType } from "zod";

export const DegradationCapabilitySchema = z.enum([
  "ai",
  "progressSync",
  "subtitles",
  "chapters",
  "thumbnails",
  "analytics",
]);
export type DegradationCapability = z.infer<typeof DegradationCapabilitySchema>;
export type CapabilityHealth = "healthy" | "retrying" | "unavailable";
export type DegradationLevel = 0 | 1 | 2 | 3 | 4;

export interface DegradationSnapshot {
  level: DegradationLevel;
  label:
    | "Full experience"
    | "No AI"
    | "Local progress only"
    | "Video + local progress only"
    | "Video only";
  localProgress: boolean;
  health: Readonly<Record<DegradationCapability, CapabilityHealth>>;
  attempts: Readonly<Record<DegradationCapability, number>>;
}

export interface IsolatedOperation<T> {
  capability: DegradationCapability;
  operation: () => Promise<unknown> | unknown;
  schema: ZodType<T>;
  fallback: T;
  timeoutMs?: number;
  retry?: () => Promise<unknown> | unknown;
}

const CAPABILITIES = DegradationCapabilitySchema.options;
const healthy = (): Record<DegradationCapability, CapabilityHealth> =>
  Object.fromEntries(CAPABILITIES.map((capability) => [capability, "healthy"])) as Record<
    DegradationCapability,
    CapabilityHealth
  >;
const zeroAttempts = (): Record<DegradationCapability, number> =>
  Object.fromEntries(CAPABILITIES.map((capability) => [capability, 0])) as Record<
    DegradationCapability,
    number
  >;

/**
 * Owns optional-capability health only. It has no reference to PlayerEngine, so failures and
 * retries cannot alter playback state or enter the command path.
 */
export class DegradationManager {
  private health = healthy();
  private attempts = zeroAttempts();
  private localProgress = true;
  private listeners = new Set<() => void>();
  private timers = new Map<DegradationCapability, ReturnType<typeof setTimeout>>();
  private snapshot = this.compute();
  private disposed = false;

  constructor(
    private readonly options: {
      timeoutMs?: number;
      baseRetryMs?: number;
      maxRetryMs?: number;
    } = {},
  ) {}

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getSnapshot = (): DegradationSnapshot => this.snapshot;

  isEnabled(capability: DegradationCapability): boolean {
    const level = this.snapshot.level;
    if (capability === "ai") return level === 0;
    if (capability === "progressSync") return level < 2;
    if (["subtitles", "chapters", "thumbnails"].includes(capability)) return level < 3;
    return this.health.analytics === "healthy";
  }

  reportHealthy(input: unknown): void {
    const capability = DegradationCapabilitySchema.parse(input);
    this.cancel(capability);
    this.health = { ...this.health, [capability]: "healthy" };
    this.attempts = { ...this.attempts, [capability]: 0 };
    this.publish();
  }

  reportUnavailable(
    input: unknown,
    retry?: () => Promise<unknown> | unknown,
    schema: ZodType<unknown> = z.literal(true),
  ): void {
    const parsed = DegradationCapabilitySchema.safeParse(input);
    if (!parsed.success || this.disposed) return;
    const capability = parsed.data;
    this.health = { ...this.health, [capability]: retry ? "retrying" : "unavailable" };
    this.publish();
    if (retry) this.schedule(capability, retry, schema);
  }

  reportLocalProgress(available: boolean): void {
    this.localProgress = z.boolean().parse(available);
    this.publish();
  }

  cancelRetry(input: unknown): void {
    const parsed = DegradationCapabilitySchema.safeParse(input);
    if (parsed.success) this.cancel(parsed.data);
  }

  async run<T>(input: IsolatedOperation<T>): Promise<T> {
    const capability = DegradationCapabilitySchema.parse(input.capability);
    try {
      const value = await this.bounded(input.operation, input.timeoutMs);
      const parsed = input.schema.parse(value);
      this.reportHealthy(capability);
      return parsed;
    } catch {
      this.reportUnavailable(capability, input.retry ?? input.operation, input.schema);
      return input.fallback;
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.listeners.clear();
  }

  private async bounded(operation: () => Promise<unknown> | unknown, timeoutMs?: number) {
    const limit = timeoutMs ?? this.options.timeoutMs ?? 1500;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        Promise.resolve().then(operation),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("Optional capability timed out")), limit);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private schedule(
    capability: DegradationCapability,
    retry: () => Promise<unknown> | unknown,
    schema: ZodType<unknown>,
  ): void {
    if (this.disposed || this.timers.has(capability)) return;
    const attempt = this.attempts[capability] + 1;
    this.attempts = { ...this.attempts, [capability]: attempt };
    const delay = Math.min(
      this.options.maxRetryMs ?? 60_000,
      (this.options.baseRetryMs ?? 1_000) * 2 ** Math.min(6, attempt - 1),
    );
    const timer = setTimeout(() => {
      this.timers.delete(capability);
      void this.bounded(retry).then(
        (value) => {
          const parsed = schema.safeParse(value);
          if (parsed.success) this.reportHealthy(capability);
          else this.reportUnavailable(capability, retry, schema);
        },
        () => this.reportUnavailable(capability, retry, schema),
      );
    }, delay);
    this.timers.set(capability, timer);
    this.publish();
  }

  private cancel(capability: DegradationCapability): void {
    const timer = this.timers.get(capability);
    if (timer) clearTimeout(timer);
    this.timers.delete(capability);
  }

  private compute(): DegradationSnapshot {
    let level: DegradationLevel = 0;
    if (this.health.ai !== "healthy" || this.health.analytics !== "healthy") level = 1;
    if (this.health.progressSync !== "healthy") level = 2;
    if (
      this.health.subtitles !== "healthy" ||
      this.health.chapters !== "healthy" ||
      this.health.thumbnails !== "healthy"
    )
      level = 3;
    if (!this.localProgress) level = 4;
    const labels = [
      "Full experience",
      "No AI",
      "Local progress only",
      "Video + local progress only",
      "Video only",
    ] as const;
    return Object.freeze({
      level,
      label: labels[level],
      localProgress: this.localProgress,
      health: Object.freeze({ ...this.health }),
      attempts: Object.freeze({ ...this.attempts }),
    });
  }

  private publish(): void {
    const next = this.compute();
    const changed = JSON.stringify(next) !== JSON.stringify(this.snapshot);
    this.snapshot = next;
    if (!changed) return;
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        // Health observers are optional and cannot affect playback.
      }
    }
  }
}
