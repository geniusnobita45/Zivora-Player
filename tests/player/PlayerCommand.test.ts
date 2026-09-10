import { describe, expect, it } from "vitest";
import { PlayerCommandSchema } from "@/core/player/PlayerCommand";
import { PlayerCommandValidator } from "@/core/player/PlayerCommandValidator";
const context = { position: 50, duration: 100 };
const command = (action: object, source = "ui", issuedAt = 0) => ({ source, issuedAt, ...action });

describe("command validation", () => {
  it.each([
    { type: "PLAY" },
    { type: "PAUSE" },
    { type: "TOGGLE_PLAY" },
    { type: "SEEK_TO", seconds: 40 },
    { type: "SEEK_BY", delta: -10 },
    { type: "SET_VOLUME", level: 0.5 },
    { type: "SET_MUTED", muted: true },
    { type: "SET_RATE", rate: 3 },
    { type: "SELECT_QUALITY", id: "720p" },
    { type: "ENABLE_AUTO_QUALITY" },
    { type: "SELECT_AUDIO", lang: "en-US" },
    { type: "SELECT_SUBTITLE", lang: null },
    { type: "TOGGLE_FULLSCREEN" },
    { type: "TOGGLE_PIP" },
    { type: "SKIP_SEGMENT", segmentId: "intro" },
  ])("accepts %j with common metadata", (action) => {
    expect(
      new PlayerCommandValidator().parse(command(action), {
        ...context,
        skipSegments: [{ id: "intro", start: 0, end: 70 }],
      }).ok,
    ).toBe(true);
  });
  it.each([
    null,
    undefined,
    {},
    { type: "PLAY" },
    command({ type: "FLY" }),
    command({ type: "SET_RATE", rate: 3.01 }),
    command({ type: "SET_RATE", rate: 0.24 }),
    command({ type: "SET_VOLUME", level: -1 }),
    command({ type: "SET_VOLUME", level: 2 }),
    command({ type: "SEEK_TO", seconds: Infinity }),
    command({ type: "SEEK_BY", delta: NaN }),
    command({ type: "PLAY", extra: true }),
    command({ type: "SELECT_QUALITY", id: "auto" }),
    command({ type: "SELECT_AUDIO", lang: "" }),
    command({ type: "SELECT_SUBTITLE", lang: 123 }),
    command({ type: "PLAY" }, "server"),
    command({ type: "PLAY" }, "ui", -1),
  ])("returns an error without throwing for %j", (input) => {
    const validator = new PlayerCommandValidator();
    expect(() => validator.parse(input, context)).not.toThrow();
    expect(validator.parse(input, context)).toMatchObject({
      ok: false,
      error: { code: "INVALID_COMMAND" },
    });
  });
  it("does not throw when an input getter throws", () => {
    const input = {
      get type(): string {
        throw new Error("Bad getter");
      },
    };
    expect(new PlayerCommandValidator().parse(input, context).ok).toBe(false);
  });
  it("clamps absolute and relative seeks, including zero-duration media", () => {
    const validator = new PlayerCommandValidator();
    expect(validator.parse(command({ type: "SEEK_TO", seconds: -1 }), context)).toMatchObject({
      ok: true,
      value: { seconds: 0 },
    });
    expect(validator.parse(command({ type: "SEEK_TO", seconds: 1000 }), context)).toMatchObject({
      ok: true,
      value: { seconds: 100 },
    });
    expect(validator.parse(command({ type: "SEEK_BY", delta: -1000 }), context)).toMatchObject({
      ok: true,
      value: { delta: -50 },
    });
    expect(validator.parse(command({ type: "SEEK_BY", delta: 1000 }), context)).toMatchObject({
      ok: true,
      value: { delta: 50 },
    });
    expect(
      validator.parse(command({ type: "SEEK_TO", seconds: 80 }), { duration: 0, position: 0 }),
    ).toMatchObject({ ok: true, value: { seconds: 0 } });
  });
  it("rejects invalid playback context and unknown skip IDs", () => {
    const validator = new PlayerCommandValidator();
    expect(
      validator.parse(command({ type: "PLAY" }), { position: 0, duration: Infinity }),
    ).toMatchObject({ ok: false, error: { code: "INVALID_CONTEXT" } });
    expect(
      validator.parse(command({ type: "SKIP_SEGMENT", segmentId: "unknown" }), context),
    ).toMatchObject({ ok: false, error: { code: "UNKNOWN_SEGMENT" } });
  });
  it("returns a frozen command without mutating the input", () => {
    const input = command({ type: "SEEK_TO", seconds: 1000 });
    const result = new PlayerCommandValidator().parse(input, context);
    expect(result.ok && Object.isFrozen(result.value)).toBe(true);
    expect(input).toMatchObject({ seconds: 1000 });
  });
  it("enforces one AI seek per 2 seconds using receipt time, including skip commands", () => {
    let now = 0;
    const validator = new PlayerCommandValidator(() => now);
    expect(validator.parse(command({ type: "SEEK_TO", seconds: 10 }, "ai"), context).ok).toBe(true);
    now = 1999;
    expect(
      validator.parse(command({ type: "SEEK_BY", delta: 10 }, "ai", 99999999), context),
    ).toMatchObject({ ok: false, error: { code: "RATE_LIMITED", retryAfterMs: 1 } });
    now = 2000;
    expect(
      validator.parse(command({ type: "SKIP_SEGMENT", segmentId: "intro" }, "ai"), {
        ...context,
        skipSegments: [{ id: "intro", start: 0, end: 20 }],
      }).ok,
    ).toBe(true);
    expect(validator.parse(command({ type: "SEEK_TO", seconds: 50 }, "ai"), context).ok).toBe(
      false,
    );
  });
  it("enforces a rolling 5-command/10-second limit, without restricting UI", () => {
    let now = 0;
    const validator = new PlayerCommandValidator(() => now);
    for (let i = 0; i < 5; i++) {
      now = i * 100;
      expect(validator.parse(command({ type: "PLAY" }, "ai"), context).ok).toBe(true);
    }
    expect(validator.parse(command({ type: "PAUSE" }, "ai"), context)).toMatchObject({
      ok: false,
      error: { retryAfterMs: 9600 },
    });
    for (const source of ["ui", "keyboard", "gesture"])
      expect(validator.parse(command({ type: "PAUSE" }, source), context).ok).toBe(true);
    now = 10000;
    expect(validator.parse(command({ type: "PLAY" }, "ai"), context).ok).toBe(true);
    expect(validator.parse(command({ type: "PLAY" }, "ai"), context).ok).toBe(false);
  });
  it("does not consume quota on invalid commands, and tolerates clock rollback", () => {
    let now = 100;
    const validator = new PlayerCommandValidator(() => now);
    for (let i = 0; i < 10; i++)
      validator.parse(command({ type: "SET_RATE", rate: 10 }, "ai"), context);
    expect(validator.parse(command({ type: "SEEK_BY", delta: 1 }, "ai"), context).ok).toBe(true);
    now = 0;
    expect(validator.parse(command({ type: "SEEK_BY", delta: 1 }, "ai"), context).ok).toBe(false);
    expect(PlayerCommandSchema.safeParse(command({ type: "SET_RATE", rate: 0.25 })).success).toBe(
      true,
    );
  });
});
