import Link from "next/link";
import type { CatalogItem } from "@/features/recommendations";
export function CatalogGrid({
  items,
  empty = "Nothing to show yet.",
}: {
  items: CatalogItem[];
  empty?: string;
}) {
  if (!items.length)
    return (
      <p className="rounded-xl border border-dashed border-slate-700 p-8 text-slate-400">{empty}</p>
    );
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {items.map((item) => (
        <Link
          key={item.id}
          href={`/title/${item.id}`}
          className="group rounded-xl border border-slate-800 bg-slate-900/70 p-4 transition hover:-translate-y-0.5 hover:border-violet-400"
        >
          <div
            className="mb-4 aspect-video rounded-lg bg-gradient-to-br from-violet-950 via-slate-800 to-slate-950"
            aria-hidden="true"
          />
          <h2 className="font-semibold group-hover:text-violet-200">{item.title}</h2>
          <p className="mt-1 line-clamp-2 text-sm text-slate-400">
            {item.synopsis ?? "Ready to watch on Zivora."}
          </p>
        </Link>
      ))}
    </div>
  );
}
