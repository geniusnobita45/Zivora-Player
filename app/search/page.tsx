import { readReadyCatalog } from "@/lib/supabase/catalog";
import { CatalogGrid } from "@/components/shared/CatalogGrid";
import { SiteShell } from "@/components/shared/SiteShell";
import type { CatalogItem } from "@/features/recommendations";
export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const query = (await searchParams).q ?? "";
  let items: CatalogItem[] = [];
  try {
    items = await readReadyCatalog(query);
  } catch {
    /* empty state */
  }
  return (
    <SiteShell title="Search">
      <form className="mb-8 flex max-w-2xl gap-2">
        <label className="sr-only" htmlFor="q">
          Search titles
        </label>
        <input
          id="q"
          name="q"
          defaultValue={query}
          placeholder="Search titles, genres, moments"
          className="min-h-12 flex-1 rounded-lg border border-slate-700 bg-slate-900 px-4"
        />
        <button className="rounded-lg bg-violet-300 px-5 font-semibold text-slate-950">
          Search
        </button>
      </form>
      <h1 className="mb-6 text-3xl font-bold">
        {query ? `Results for “${query}”` : "All published titles"}
      </h1>
      <CatalogGrid items={items} empty="No READY titles matched that search." />
    </SiteShell>
  );
}
