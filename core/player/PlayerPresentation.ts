import { PlaybackError } from "./PlayerErrors";
export interface PlayerPresentation {
  toggleFullscreen(): Promise<void>;
  togglePictureInPicture(): Promise<void>;
}
export function presentationUnavailable(): PlaybackError {
  return new PlaybackError("This presentation mode is unavailable", {
    code: "PRESENTATION_UNAVAILABLE",
    category: "adapter",
    fatal: false,
    recoverable: false,
  });
}
/** Native browser presentation only; playback stays in the engine/adapter path. */
export class BrowserPlayerPresentation implements PlayerPresentation {
  constructor(
    private readonly video: HTMLVideoElement,
    private readonly container: HTMLElement = video,
  ) {}
  async toggleFullscreen(): Promise<void> {
    const document = this.container.ownerDocument;
    if (document.fullscreenElement === this.container) await document.exitFullscreen();
    else {
      if (typeof this.container.requestFullscreen !== "function") throw presentationUnavailable();
      await this.container.requestFullscreen();
    }
  }
  async togglePictureInPicture(): Promise<void> {
    const document = this.video.ownerDocument;
    if (document.pictureInPictureElement === this.video) await document.exitPictureInPicture();
    else {
      if (
        !document.pictureInPictureEnabled ||
        typeof this.video.requestPictureInPicture !== "function"
      )
        throw presentationUnavailable();
      await this.video.requestPictureInPicture();
    }
  }
}
