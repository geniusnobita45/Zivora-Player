export enum ContentState {
  Uploaded = "UPLOADED",
  Processing = "PROCESSING",
  AIProcessing = "AI_PROCESSING",
  Validating = "VALIDATING",
  Ready = "READY",
  Failed = "FAILED",
}
export type MediaVersion = {
  id: string;
  contentId: string;
  version: number;
  manifestUrl: string;
  immutableHash: string;
  state: ContentState;
  publishedAt: string | null;
};
export type Rendition = {
  id: string;
  mediaVersionId: string;
  width: number;
  height: number;
  bitrate: number;
  codec: string;
  uri: string;
};
export type Episode = {
  id: string;
  showId: string;
  seasonNumber: number;
  episodeNumber: number;
  title: string;
  durationSeconds: number;
  mediaVersionId: string;
};
export type WatchState = {
  currentEpisodeOrder: number;
  currentPosition: number;
  furthestEpisodeOrder: number;
  furthestPosition: number;
};
