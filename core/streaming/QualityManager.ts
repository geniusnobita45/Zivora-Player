import { z } from "zod";
import { QualitySchema, type Quality } from "@/core/adapters/PlaybackAdapter";
export interface QualityChange {
  at: number;
  id: string | null;
  automatic: boolean;
  bandwidth: number | null;
}
export class QualityManager {
  private renditions: Quality[] = [];
  private automatic = true;
  private selectedId: string | null = null;
  private changes: QualityChange[] = [];
  constructor(
    private readonly now: () => number = Date.now,
    private readonly logLimit = 100,
  ) {
    z.number().int().positive().max(10_000).parse(logLimit);
  }
  setRenditions(input: unknown): void {
    const tracks = z.array(QualitySchema).parse(input);
    if (new Set(tracks.map((track) => track.id)).size !== tracks.length)
      throw new Error("Duplicate rendition IDs");
    this.renditions = tracks;
    if (this.selectedId && !tracks.some((track) => track.id === this.selectedId)) {
      this.selectedId = null;
      this.automatic = true;
    }
  }
  resolve(id: string): Quality | null {
    const track = this.renditions.find((track) => track.id === id);
    return track ? { ...track } : null;
  }
  recordChange(input: unknown): void {
    const event = z
      .object({ quality: QualitySchema.nullable(), automatic: z.boolean() })
      .parse(input);
    const id = event.quality?.id ?? null;
    if (id === this.selectedId && event.automatic === this.automatic) return;
    const at = z.number().finite().nonnegative().parse(this.now());
    this.selectedId = id;
    this.automatic = event.automatic;
    this.renditions = this.renditions.map((track) => ({ ...track, active: track.id === id }));
    this.changes.push({
      at,
      id,
      automatic: this.automatic,
      bandwidth: event.quality?.bandwidth ?? null,
    });
    this.changes = this.changes.slice(-this.logLimit);
  }
  getSnapshot() {
    return {
      renditions: this.renditions.map((track) => ({ ...track })),
      automatic: this.automatic,
      selectedId: this.selectedId,
      changes: this.changes.map((change) => ({ ...change })),
    };
  }
  reset(): void {
    this.renditions = [];
    this.automatic = true;
    this.selectedId = null;
    this.changes = [];
  }
}
