import Link from "next/link";
import type { ReactNode } from "react";

export function SiteShell({ children, title = "Zivora" }: { children: ReactNode; title?: string }) {
  return (
    <div className="min-h-svh bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 bg-slate-950/90">
        <div className="mx-auto flex max-w-7xl items-center gap-6 px-5 py-4">
          <Link href="/" className="font-black tracking-[.2em] text-violet-300">
            ZIVORA
          </Link>
          <nav className="flex gap-4 text-sm text-slate-300" aria-label="Primary">
            <Link href="/browse">Browse</Link>
            <Link href="/search">Search</Link>
            <Link href="/library">Library</Link>
            <Link href="/history">History</Link>
            <Link href="/settings">Settings</Link>
          </nav>
        </div>
      </header>
      <main>
        <div className="mx-auto max-w-7xl px-5 py-10">
          <p className="mb-2 text-xs font-bold tracking-[.18em] text-violet-300">
            {title.toUpperCase()}
          </p>
          {children}
        </div>
      </main>
    </div>
  );
}
