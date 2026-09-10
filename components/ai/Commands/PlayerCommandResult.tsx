"use client";
import type { PlayerCommand } from "@/core/player/PlayerCommand";
import { usePlayer } from "@/components/player/PlayerContext";

export function PlayerCommandResult({ command }: { command: PlayerCommand }) {
  const { perform } = usePlayer();
  return (
    <button
      type="button"
      className="rounded-full border border-violet-300/70 px-3 py-1.5 text-xs font-semibold text-violet-100 hover:bg-violet-400/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-200"
      onClick={() => perform((controller) => controller.dispatch(command))}
    >
      Run player command
    </button>
  );
}
