export type PlaybackErrorCategory =
  "network" | "manifest" | "media" | "drm" | "adapter" | "unknown";

export interface PlaybackErrorOptions {
  code: string;
  category: PlaybackErrorCategory;
  fatal: boolean;
  recoverable: boolean;
  cause?: unknown;
}

export class PlaybackError extends Error {
  readonly code: string;
  readonly category: PlaybackErrorCategory;
  readonly fatal: boolean;
  readonly recoverable: boolean;

  constructor(message: string, options: PlaybackErrorOptions) {
    super(message, { cause: options.cause });
    this.name = "PlaybackError";
    this.code = options.code;
    this.category = options.category;
    this.fatal = options.fatal;
    this.recoverable = options.recoverable;
  }
}

export function toPlaybackError(cause: unknown): PlaybackError {
  if (cause instanceof PlaybackError) return cause;
  return new PlaybackError("Playback operation failed", {
    code: "UNEXPECTED_ERROR",
    category: "unknown",
    fatal: true,
    recoverable: false,
    cause,
  });
}

export function adapterError(code: string, message: string, cause?: unknown): PlaybackError {
  const fatal = ![
    "TRACK_NOT_FOUND",
    "NOT_READY",
    "LOAD_IN_PROGRESS",
    "OPERATION_CANCELLED",
  ].includes(code);
  return new PlaybackError(message, {
    code,
    category: "adapter",
    fatal,
    recoverable: false,
    cause,
  });
}
