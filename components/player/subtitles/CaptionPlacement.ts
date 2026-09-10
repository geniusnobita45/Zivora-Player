import { z } from "zod";
const Placement = z.object({
  line: z.union([z.literal("auto"), z.number().finite()]),
  snapToLines: z.boolean(),
});
type CuePlacement = z.infer<typeof Placement>;

/** Native-caption presentation only; does not select tracks or control playback. */
export class CaptionPlacement {
  private readonly originals = new Map<CuePlacement, CuePlacement>();
  update(cues: readonly unknown[], controlsVisible: boolean): void {
    const active = new Set(cues);
    for (const [cue, original] of this.originals) {
      if (controlsVisible && active.has(cue)) continue;
      this.originals.delete(cue);
      cue.line = original.line;
      cue.snapToLines = original.snapToLines;
    }
    if (!controlsVisible) return;
    for (const input of cues) {
      // Native cue setters may themselves emit cuechange. Never rewrite an active cue.
      if (this.originals.has(input as CuePlacement)) continue;
      const parsed = Placement.safeParse(input);
      if (!parsed.success || parsed.data.line !== "auto") continue;
      const cue = input as CuePlacement;
      this.originals.set(cue, parsed.data);
      cue.snapToLines = false;
      cue.line = 65;
    }
  }
  clear(): void {
    const originals = [...this.originals];
    this.originals.clear();
    for (const [cue, original] of originals) {
      cue.line = original.line;
      cue.snapToLines = original.snapToLines;
    }
  }
}
export function observeCaptionPlacement(
  video: HTMLVideoElement,
  controlsVisible: boolean,
): () => void {
  if (!video.textTracks || typeof video.textTracks.addEventListener !== "function") return () => {};
  const placement = new CaptionPlacement();
  const tracks = new Set<TextTrack>();
  const update = () => {
    for (const track of Array.from(video.textTracks)) {
      if (!tracks.has(track)) {
        tracks.add(track);
        track.addEventListener("cuechange", update);
      }
    }
    placement.update(
      Array.from(video.textTracks).flatMap((track) => Array.from(track.activeCues ?? [])),
      controlsVisible,
    );
  };
  update();
  video.textTracks.addEventListener("addtrack", update);
  video.textTracks.addEventListener("change", update);
  return () => {
    video.textTracks.removeEventListener("addtrack", update);
    video.textTracks.removeEventListener("change", update);
    tracks.forEach((track) => track.removeEventListener("cuechange", update));
    placement.clear();
  };
}
