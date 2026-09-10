import { PlayerCommandSchema, type PlayerCommand } from "@/core/player/PlayerCommand";
import { PlayerCommandValidator } from "@/core/player/PlayerCommandValidator";
import type { PlayerController } from "@/core/player/PlayerController";
import type { AIAnswer } from "../orchestrator/contracts";
import { withinBoundary, type WatchBoundary } from "../spoiler-guard/WatchBoundary";
export function seekCommand(
  answer: AIAnswer,
  episodeId: string | null,
  episodeOrder: number,
  boundary: WatchBoundary,
  position: number,
  duration: number,
  now = Date.now(),
): PlayerCommand | undefined {
  if (answer.confidence < 0.8 || answer.candidates.length !== 1) return undefined;
  const candidate = answer.candidates[0];
  if (
    candidate.confidence < 0.8 ||
    candidate.episodeId !== episodeId ||
    !withinBoundary(episodeOrder, candidate.timestamp, boundary)
  )
    return undefined;
  const validated = new PlayerCommandValidator(() => now).parse(
    {
      type: "SEEK_TO",
      seconds: candidate.timestamp,
      source: "ai",
      reason: candidate.label,
      issuedAt: now,
    },
    { position, duration },
  );
  return validated.ok ? validated.value : undefined;
}
/** Explicit controls are deterministic; arbitrary model-proposed commands are not executed. */
export function directCommand(
  question: string,
  position: number,
  duration: number,
  now = Date.now(),
): PlayerCommand | undefined {
  const text = question
    .normalize("NFKC")
    .toLowerCase()
    .trim()
    .replace(/^please\s+/, "")
    .replace(/[.!?]+$/, "");
  const commands: Record<string, string> = {
    play: "PLAY",
    resume: "PLAY",
    pause: "PAUSE",
    fullscreen: "TOGGLE_FULLSCREEN",
    "picture in picture": "TOGGLE_PIP",
  };
  let command: unknown;
  if (commands[text]) command = { type: commands[text] };
  else if (text === "mute" || text === "unmute")
    command = { type: "SET_MUTED", muted: text === "mute" };
  else {
    const rate = /^set (?:the )?speed (?:to )?(\d+(?:\.\d+)?)x?$/.exec(text);
    const volume = /^set (?:the )?volume (?:to )?(\d+(?:\.\d+)?)%$/.exec(text);
    if (rate) command = { type: "SET_RATE", rate: Number(rate[1]) };
    else if (volume) command = { type: "SET_VOLUME", level: Number(volume[1]) / 100 };
  }
  if (!command) return undefined;
  const parsed = new PlayerCommandValidator(() => now).parse(
    {
      ...(command as object),
      source: "ai",
      reason: question.slice(0, 500),
      issuedAt: now,
    },
    { position, duration },
  );
  return parsed.ok ? parsed.value : undefined;
}
/** Controller owns the session validator and rechecks rate limits and live duration. */
export function dispatchAICommand(input: unknown, controller: Pick<PlayerController, "dispatch">) {
  const command = PlayerCommandSchema.parse(input);
  if (command.source !== "ai") throw new Error("AI command source required");
  return controller.dispatch(command);
}
