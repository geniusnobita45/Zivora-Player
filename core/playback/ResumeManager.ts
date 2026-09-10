import type { Progress } from "./ProgressManager";
export class ResumeManager {
  position(progress: Progress | null, duration: number) {
    return resumePosition(progress, duration);
  }
  shouldAdvance(position: number, duration: number): boolean {
    return (
      Number.isFinite(position) && Number.isFinite(duration) && duration > 0 && position >= duration
    );
  }
}
export function resumePosition(progress: Progress | null, duration: number): number | null {
  if (
    !progress ||
    !Number.isFinite(duration) ||
    duration <= 0 ||
    progress.position < 5 ||
    progress.position >= duration - 10
  )
    return null;
  return Math.min(progress.position, duration);
}
