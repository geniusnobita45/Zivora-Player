import { z } from "zod";
const PointerSchema = z.object({
  id: z.number().int(),
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite().positive(),
  height: z.number().finite().positive(),
});
type Pointer = z.infer<typeof PointerSchema>;
export interface GestureActions {
  tap(): void;
  seek(delta: number): void;
  rate(rate: number): void;
  volume(level: number): void;
  snapshot(): { rate: number; volume: number };
  feedback(message: string | null): void;
}
export class GestureRecognizer {
  private pointer:
    (Pointer & { volume: number; rate: number; moved: boolean; boosted: boolean }) | null = null;
  private hold: ReturnType<typeof setTimeout> | null = null;
  private tapTimer: ReturnType<typeof setTimeout> | null = null;
  private previousTap: { x: number; y: number; at: number } | null = null;
  constructor(
    private readonly actions: GestureActions,
    private readonly now = Date.now,
  ) {}
  down(input: unknown): void {
    const result = PointerSchema.safeParse(input);
    if (!result.success) return;
    if (this.pointer) {
      this.cancel();
      return;
    }
    this.pointer = { ...result.data, ...this.actions.snapshot(), moved: false, boosted: false };
    this.hold = setTimeout(() => {
      if (!this.pointer || this.pointer.moved) return;
      this.clearTap();
      this.pointer.boosted = true;
      this.actions.rate(2);
      this.actions.feedback("2× while holding");
    }, 500);
  }
  move(input: unknown): void {
    const result = PointerSchema.safeParse(input);
    const start = this.pointer;
    if (!result.success || !start || result.data.id !== start.id || start.boosted) return;
    const dx = result.data.x - start.x;
    const dy = start.y - result.data.y;
    if (Math.hypot(dx, dy) < 12) return;
    start.moved = true;
    this.clearHold();
    this.clearTap();
    if (Math.abs(dy) > Math.abs(dx)) {
      const level = Math.max(0, Math.min(1, start.volume + dy / start.height));
      this.actions.volume(level);
      this.actions.feedback(`Volume ${Math.round(level * 100)}%`);
    }
  }
  up(input: unknown): void {
    const result = PointerSchema.safeParse(input);
    const start = this.pointer;
    if (!result.success || !start || result.data.id !== start.id) return;
    this.clearHold();
    this.pointer = null;
    if (start.boosted) {
      this.actions.rate(start.rate);
      this.actions.feedback(null);
      return;
    }
    if (start.moved) {
      this.actions.feedback(null);
      return;
    }
    const at = this.now();
    const previous = this.previousTap;
    if (
      previous &&
      at - previous.at <= 300 &&
      Math.hypot(previous.x - start.x, previous.y - start.y) < 60
    ) {
      this.clearTap();
      const delta = start.x < start.width / 2 ? -10 : 10;
      this.actions.seek(delta);
      this.actions.feedback(`${delta > 0 ? "+" : "−"}10 seconds`);
      this.tapTimer = setTimeout(() => this.actions.feedback(null), 700);
    } else {
      this.clearTap();
      this.previousTap = { x: start.x, y: start.y, at };
      this.tapTimer = setTimeout(() => {
        this.previousTap = null;
        this.actions.tap();
      }, 300);
    }
  }
  private clearHold() {
    if (this.hold) clearTimeout(this.hold);
    this.hold = null;
  }
  lostCapture(id: number): void {
    if (this.pointer?.id === id) this.cancel();
  }
  private clearTap() {
    if (this.tapTimer) clearTimeout(this.tapTimer);
    this.tapTimer = null;
    this.previousTap = null;
  }
  cancel(): void {
    this.clearHold();
    this.clearTap();
    if (this.pointer?.boosted) this.actions.rate(this.pointer.rate);
    this.pointer = null;
    this.actions.feedback(null);
  }
}
