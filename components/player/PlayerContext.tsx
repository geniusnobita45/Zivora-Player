"use client";
import { createContext, useContext, useSyncExternalStore } from "react";
import { useStore } from "zustand";
import type { PlayerController, DispatchResult } from "@/core/player/PlayerController";
import type { PlayerStore, PlayerStoreState } from "@/stores/player.store";
import type { WatchItem } from "@/types/watch";
import type { TimelineData } from "@/types/timeline";
import type { SubtitleStore } from "@/stores/subtitle.store";
import type { BookmarkManager } from "@/core/playback/BookmarkManager";
import {
  DegradationManager,
  type DegradationSnapshot,
} from "@/services/degradation/DegradationManager";
const defaultDegradation = new DegradationManager();
export interface PlayerContextValue {
  timeline?: TimelineData;
  subtitleStore?: SubtitleStore;
  bookmarks?: BookmarkManager;
  degradation?: DegradationManager;
  controller: PlayerController | null;
  store: PlayerStore;
  item: WatchItem;
  next: WatchItem | null;
  perform: (command: (controller: PlayerController) => Promise<DispatchResult>) => void;
  retry: () => void;
  resume: (position: number) => void;
  playNext: () => void;
}
export const PlayerContext = createContext<PlayerContextValue | null>(null);
export function usePlayer() {
  const value = useContext(PlayerContext);
  if (!value) throw new Error("Player components require ZivoraPlayer context");
  return value;
}
export function usePlayerStore<T>(selector: (state: PlayerStoreState) => T): T {
  return useStore(usePlayer().store, selector);
}
export function useDegradation(): DegradationSnapshot {
  const manager = useDegradationManager();
  return useSyncExternalStore(manager.subscribe, manager.getSnapshot, manager.getSnapshot);
}
export function useDegradationManager(): DegradationManager {
  return usePlayer().degradation ?? defaultDegradation;
}
