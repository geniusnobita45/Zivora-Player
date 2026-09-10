import { z } from "zod";
export const PresentedCueSchema = z
  .object({
    id: z.string().max(12000),
    start: z.number().finite().nonnegative(),
    end: z.number().finite().nonnegative(),
    text: z.string().max(16000),
    speaker: z.string().max(200).optional(),
    hint: z.string().max(1000).optional(),
  })
  .strict()
  .refine((c) => c.end > c.start);
export type PresentedCue = z.infer<typeof PresentedCueSchema>;
/** Presentation-only observer; true acknowledges a healthy custom renderer. */
export interface TextPresentation {
  render(cues: readonly PresentedCue[], visible: boolean): boolean;
}
