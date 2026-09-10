"use client";
import { useState, useSyncExternalStore } from "react";
import { usePlayer } from "../PlayerContext";
import { formatTime } from "../timeline/time";
const subscribeNothing = () => () => {};
const zero = () => 0;
export function BookmarkControls() {
  const { bookmarks, controller, item, perform } = usePlayer();
  useSyncExternalStore(
    bookmarks?.subscribe ?? subscribeNothing,
    bookmarks?.getRevision ?? zero,
    zero,
  );
  const [title, setTitle] = useState("");
  const [notice, setNotice] = useState("");
  if (!bookmarks) return null;
  return (
    <section className="zivora-bookmarks" aria-label="Bookmarks">
      <h3>Bookmarks</h3>
      <label>
        Bookmark name
        <input
          maxLength={300}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Name this moment"
        />
      </label>
      <button
        type="button"
        className="zivora-secondary"
        onClick={() => {
          const position = controller?.getSnapshot().position;
          if (position === undefined) return;
          const ok = bookmarks.save({
            id: crypto.randomUUID(),
            userId: bookmarks.userId,
            contentId: item.contentId,
            episodeId: item.episodeId,
            position,
            title: title.trim() || `Bookmark at ${formatTime(position)}`,
            updatedAt: new Date().toISOString(),
            deleted: false,
          });
          setNotice(ok ? "Bookmark added." : "Could not add this bookmark.");
          if (ok) setTitle("");
        }}
      >
        Bookmark this moment
      </button>
      {bookmarks.list(item).length === 0 ? (
        <p>No saved moments yet.</p>
      ) : (
        <ul>
          {bookmarks.list(item).map((bookmark) => (
            <li key={bookmark.id}>
              <button
                type="button"
                onClick={() => perform((c) => c.seekTo(bookmark.position))}
                aria-label={`Jump to ${bookmark.title}`}
              >
                {formatTime(bookmark.position)} · {bookmark.title}
              </button>
              <button
                type="button"
                aria-label={`Remove ${bookmark.title}`}
                onClick={() => {
                  bookmarks.remove(bookmark.id);
                  setNotice("Bookmark removed.");
                }}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <p role="status">{notice}</p>
    </section>
  );
}
