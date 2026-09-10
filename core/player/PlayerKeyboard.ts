import { z } from "zod";
import { PlayerCommandSchema, type PlayerCommand } from "./PlayerCommand";
const KeySchema = z.object({
  key: z.string(),
  altKey: z.boolean().default(false),
  ctrlKey: z.boolean().default(false),
  metaKey: z.boolean().default(false),
  repeat: z.boolean().default(false),
  isComposing: z.boolean().default(false),
});
const StateSchema = z.object({
  duration: z.number().finite().nonnegative(),
  volume: z.number().finite().min(0).max(1),
  muted: z.boolean(),
});

/** Pure keyboard mapping. DOM attachment is explicitly owned by the caller. */
export function keyboardCommand(
  input: unknown,
  snapshot: unknown,
  issuedAt = Date.now(),
): PlayerCommand | null {
  try {
    const key = KeySchema.parse(input);
    const state = StateSchema.parse(snapshot);
    if (key.altKey || key.ctrlKey || key.metaKey || key.isComposing) return null;
    const common = { source: "keyboard", issuedAt, reason: "Keyboard shortcut" };
    const value = key.key.toLowerCase();
    let action: object;
    switch (value) {
      case " ":
      case "k":
        action = { type: "TOGGLE_PLAY" };
        break;
      case "arrowleft":
        action = { type: "SEEK_BY", delta: -5 };
        break;
      case "arrowright":
        action = { type: "SEEK_BY", delta: 5 };
        break;
      case "j":
        action = { type: "SEEK_BY", delta: -10 };
        break;
      case "l":
        action = { type: "SEEK_BY", delta: 10 };
        break;
      case "arrowup":
        action = { type: "SET_VOLUME", level: Math.min(1, state.volume + 0.05) };
        break;
      case "arrowdown":
        action = { type: "SET_VOLUME", level: Math.max(0, state.volume - 0.05) };
        break;
      case "m":
        action = { type: "SET_MUTED", muted: !state.muted };
        break;
      case "f":
        action = { type: "TOGGLE_FULLSCREEN" };
        break;
      case "p":
        action = { type: "TOGGLE_PIP" };
        break;
      default:
        if (!/^[0-9]$/.test(value)) return null;
        action = { type: "SEEK_TO", seconds: (state.duration * Number(value)) / 10 };
    }
    const command = PlayerCommandSchema.parse({ ...common, ...action });
    if (
      key.repeat &&
      ["TOGGLE_PLAY", "SET_MUTED", "TOGGLE_FULLSCREEN", "TOGGLE_PIP"].includes(command.type)
    )
      return null;
    return command;
  } catch {
    return null;
  }
}
