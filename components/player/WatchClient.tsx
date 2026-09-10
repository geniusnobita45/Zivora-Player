"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { playbackTransport } from "@/services/security/PlaybackRequestAuthorization";
import { WatchSelectionSchema, watchHref } from "@/types/watch";
import type { z } from "zod";
import { ZivoraPlayer } from "./ZivoraPlayer";
export function WatchClient({ contentId, episodeId }: { contentId: string; episodeId?: string }) {
  const router = useRouter();
  const [selection, setSelection] = useState<z.infer<typeof WatchSelectionSchema> | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 15_000);
    let active = true;
    setSelection(null);
    setError(false);
    void playbackTransport(
      { action: "catalog", contentId, ...(episodeId ? { episodeId } : {}) },
      abort.signal,
    )
      .then((data) => {
        const parsed = WatchSelectionSchema.parse(data);
        if (
          parsed.current.contentId !== contentId ||
          (episodeId && parsed.current.episodeId !== episodeId) ||
          (parsed.next && parsed.next.contentId !== contentId)
        )
          throw new Error("Catalog mismatch");
        if (active) setSelection(parsed);
      })
      .catch(() => {
        if (active) setError(true);
      })
      .finally(() => clearTimeout(timer));
    return () => {
      active = false;
      clearTimeout(timer);
      abort.abort();
    };
  }, [contentId, episodeId, attempt]);
  if (selection)
    return (
      <ZivoraPlayer
        item={selection.current}
        userId={selection.userId ?? null}
        timeline={selection.timeline}
        next={selection.next}
        onNext={(item) => router.push(watchHref(item))}
      />
    );
  return (
    <main className="grid min-h-svh place-items-center bg-black p-6 text-center">
      <div className="max-w-md space-y-5">
        <p className="text-xs font-semibold tracking-[.2em] text-violet-300">ZIVORA</p>
        <h1 className="text-2xl font-semibold">
          {error ? "This video isn’t available right now" : "Finding your video…"}
        </h1>
        {error ? (
          <>
            <p className="text-sm leading-6 text-slate-300">
              Check your connection or try again once the title is published.
            </p>
            <button
              className="min-h-11 rounded-lg bg-violet-200 px-5 py-3 font-semibold text-slate-950 focus-visible:outline focus-visible:outline-2"
              onClick={() => setAttempt((value) => value + 1)}
            >
              Try again
            </button>
            <Link className="block p-3 text-sm underline" href="/">
              Back to Zivora
            </Link>
          </>
        ) : (
          <p role="status" className="text-sm text-slate-400">
            Checking playback availability
          </p>
        )}
      </div>
    </main>
  );
}
