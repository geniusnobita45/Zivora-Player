import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GestureRecognizer } from "@/components/player/gestures/GestureRecognizer";
const pointer = { id: 1, x: 30, y: 100, width: 400, height: 200 };
function fixture() {
  const actions = {
    tap: vi.fn(),
    seek: vi.fn(),
    rate: vi.fn(),
    volume: vi.fn(),
    feedback: vi.fn(),
    snapshot: () => ({ rate: 1.25, volume: 0.5 }),
  };
  return { actions, recognizer: new GestureRecognizer(actions) };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
describe("player gestures", () => {
  it("delays a single tap and suppresses it on double-tap seeking", () => {
    const { actions, recognizer: r } = fixture();
    r.down(pointer);
    r.up(pointer);
    vi.advanceTimersByTime(200);
    expect(actions.tap).not.toHaveBeenCalled();
    r.down(pointer);
    r.up(pointer);
    expect(actions.seek).toHaveBeenCalledWith(-10);
    vi.advanceTimersByTime(800);
    expect(actions.tap).not.toHaveBeenCalled();
    r.down({ ...pointer, x: 330 });
    r.up({ ...pointer, x: 330 });
    vi.advanceTimersByTime(310);
    expect(actions.tap).toHaveBeenCalledOnce();
  });
  it("temporarily selects 2× and restores the original rate on release or lost capture", () => {
    const { actions, recognizer: r } = fixture();
    r.down(pointer);
    vi.advanceTimersByTime(500);
    expect(actions.rate).toHaveBeenCalledWith(2);
    r.lostCapture(1);
    expect(actions.rate).toHaveBeenLastCalledWith(1.25);
    r.down(pointer);
    vi.advanceTimersByTime(500);
    r.up(pointer);
    expect(actions.rate.mock.calls.map(([rate]) => rate)).toEqual([2, 1.25, 2, 1.25]);
    expect(actions.tap).not.toHaveBeenCalled();
    r.cancel();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("clamps vertical swipe volume and cancels taps/holds on movement", () => {
    const { actions, recognizer: r } = fixture();
    r.down(pointer);
    r.move({ ...pointer, y: -200 });
    r.up(pointer);
    expect(actions.volume).toHaveBeenLastCalledWith(1);
    vi.advanceTimersByTime(1000);
    expect(actions.rate).not.toHaveBeenCalled();
    expect(actions.tap).not.toHaveBeenCalled();
    r.down(pointer);
    r.move({ ...pointer, y: 400 });
    expect(actions.volume).toHaveBeenLastCalledWith(0);
    r.cancel();
  });
  it("cancels multi-touch, ignores invalid coordinates and does not swallow a completed tap on capture release", () => {
    const { actions, recognizer: r } = fixture();
    r.down({ ...pointer, x: NaN });
    vi.advanceTimersByTime(600);
    expect(actions.rate).not.toHaveBeenCalled();
    r.down(pointer);
    r.down({ ...pointer, id: 2 });
    vi.advanceTimersByTime(600);
    expect(actions.rate).not.toHaveBeenCalled();
    r.down(pointer);
    r.up(pointer);
    r.lostCapture(1);
    vi.advanceTimersByTime(310);
    expect(actions.tap).toHaveBeenCalledOnce();
  });
});
