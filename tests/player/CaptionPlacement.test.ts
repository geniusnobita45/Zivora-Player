import { describe, expect, it, vi } from "vitest";
import {
  CaptionPlacement,
  observeCaptionPlacement,
} from "@/components/player/subtitles/CaptionPlacement";
describe("caption presentation", () => {
  it("does not rewrite active cues when native presentation emits cuechange", () => {
    const placement = new CaptionPlacement();
    let line: number | "auto" = "auto";
    const setLine = vi.fn((value: number | "auto") => {
      line = value;
      placement.update([cue], true);
    });
    const cue = {
      get line() {
        return line;
      },
      set line(value: number | "auto") {
        setLine(value);
      },
      snapToLines: true,
    };
    placement.update([cue], true);
    placement.update([cue], true);
    expect(setLine).toHaveBeenCalledOnce();
    expect(line).toBe(65);
  });
  it("raises automatic cues above controls and restores their authored placement", () => {
    const placement = new CaptionPlacement();
    const cue = { line: "auto" as number | "auto", snapToLines: true };
    placement.update([cue], true);
    expect(cue).toEqual({ line: 65, snapToLines: false });
    placement.update([cue], false);
    expect(cue).toEqual({ line: "auto", snapToLines: true });
  });
  it("preserves authored positions, rejects malformed cues and releases inactive cues", () => {
    const placement = new CaptionPlacement();
    const cue = { line: "auto" as number | "auto", snapToLines: true };
    const authored = { line: 20, snapToLines: false };
    placement.update([cue, authored, null, { line: NaN }], true);
    expect(authored.line).toBe(20);
    placement.update([], true);
    expect(cue.line).toBe("auto");
  });
  it("observes native track events and removes presentation listeners on teardown", () => {
    const cue = { line: "auto", snapToLines: true };
    const track = Object.assign(new EventTarget(), { activeCues: [cue] });
    const list = Object.assign(new EventTarget(), { 0: track, length: 1 });
    const remove = vi.spyOn(track, "removeEventListener");
    const stop = observeCaptionPlacement({ textTracks: list } as unknown as HTMLVideoElement, true);
    expect(cue.line).toBe(65);
    track.dispatchEvent(new Event("cuechange"));
    expect(cue.line).toBe(65);
    stop();
    expect(cue.line).toBe("auto");
    expect(remove).toHaveBeenCalledWith("cuechange", expect.any(Function));
  });
});
