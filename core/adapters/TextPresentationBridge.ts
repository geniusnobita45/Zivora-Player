import { z } from "zod";
import { PresentedCueSchema, type PresentedCue, type TextPresentation } from "./TextPresentation";
/** Indexed timed-text presentation. No player control or SDK types escape this boundary. */
export class TextPresentationBridge {
  private cues: PresentedCue[] = [];
  private maximumEnds: number[] = [];
  private visible = false;
  private nativeVisible: boolean | null = null;
  private destroyed = false;
  constructor(
    private readonly output: TextPresentation,
    private readonly nativeVisibility: (visible: boolean) => void,
  ) {}
  append(input: unknown) {
    const added = z.array(PresentedCueSchema).max(200000).parse(input);
    const deduplicated = new Map(this.cues.map((c) => [JSON.stringify(c), c]));
    added.forEach((c) => deduplicated.set(JSON.stringify(c), c));
    if (deduplicated.size > 200000) throw new Error("Subtitle cue limit exceeded");
    this.cues = [...deduplicated.values()].sort((a, b) => a.start - b.start);
    this.index();
  }
  private index() {
    let end = 0;
    this.maximumEnds = this.cues.map((c) => (end = Math.max(end, c.end)));
  }
  remove(start: number, end: number) {
    this.cues = this.cues.filter((c) => !(c.start >= start && c.end <= end));
    this.index();
  }
  setVisible(visible: boolean) {
    this.visible = visible;
  }
  isVisible() {
    return this.visible;
  }
  update(time: number, nativeOnly = false) {
    if (this.destroyed) return;
    let healthy = false;
    try {
      z.number().finite().nonnegative().parse(time);
      let low = 0,
        high = this.cues.length;
      while (low < high) {
        const middle = (low + high) >>> 1;
        if (this.cues[middle].start <= time) low = middle + 1;
        else high = middle;
      }
      const active: PresentedCue[] = [];
      for (let i = low - 1; i >= 0 && this.maximumEnds[i] > time; i--) {
        if (this.cues[i].end > time) active.unshift(this.cues[i]);
        if (active.length > 100) throw new Error("Too many simultaneous captions");
      }
      healthy = this.output.render(
        this.visible && !nativeOnly ? active : [],
        this.visible && !nativeOnly,
      );
    } catch {
      /* An optional renderer must not propagate an error into the engine. */
    }
    const showNative = this.visible && (!healthy || nativeOnly);
    if (showNative !== this.nativeVisible) {
      this.nativeVisibility(showNative);
      this.nativeVisible = showNative;
    }
  }
  destroy() {
    this.destroyed = true;
    this.cues = [];
    this.maximumEnds = [];
    try {
      this.output.render([], false);
    } catch {
      /* Detached renderer. */
    }
  }
}
