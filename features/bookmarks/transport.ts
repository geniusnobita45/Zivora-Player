import type { BookmarkRemote } from "@/core/playback/BookmarkManager";
export const bookmarkTransport: BookmarkRemote = {
  async list(target) {
    const query = new URLSearchParams({
      contentId: target.contentId,
      ...(target.episodeId ? { episodeId: target.episodeId } : {}),
    });
    const response = await fetch(`/api/bookmarks?${query}`, {
      cache: "no-store",
      credentials: "same-origin",
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error("Bookmarks unavailable");
    return (await response.json()).bookmarks;
  },
  async put(value) {
    const response = await fetch("/api/bookmarks", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(value),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error("Bookmark sync unavailable");
    return (await response.json()).bookmark;
  },
};
