import Link from "next/link";
import { SiteShell } from "@/components/shared/SiteShell";
export default function Home() {
  return (
    <SiteShell title="Watch with context">
      <section className="grid gap-10 py-12 lg:grid-cols-[1.15fr_.85fr] lg:items-center">
        <div>
          <p className="mb-4 text-sm text-violet-200">A calmer way to watch</p>
          <h1 className="max-w-3xl text-5xl font-black tracking-tight sm:text-7xl">
            Your library, with a little more understanding.
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-8 text-slate-400">
            Find the moment, remember what happened, and keep spoilers behind the line you have
            actually watched.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/browse"
              className="rounded-lg bg-violet-300 px-5 py-3 font-semibold text-slate-950"
            >
              Browse library
            </Link>
            <Link
              href="/search"
              className="rounded-lg border border-slate-700 px-5 py-3 font-semibold"
            >
              Search titles
            </Link>
          </div>
        </div>
        <div className="rounded-3xl border border-violet-400/20 bg-gradient-to-br from-violet-950/80 via-slate-900 to-slate-950 p-8">
          <p className="text-xs font-bold tracking-[.2em] text-violet-300">ZIVORA AI</p>
          <p className="mt-20 text-3xl font-semibold">Ask about the scene you are in.</p>
          <p className="mt-3 text-slate-400">Every answer respects your current watch boundary.</p>
        </div>
      </section>
    </SiteShell>
  );
}
