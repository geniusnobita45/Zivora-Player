import { SiteShell } from "@/components/shared/SiteShell";
import { CatalogGrid } from "@/components/shared/CatalogGrid";
import { readUserLibrary } from "@/lib/supabase/catalog";
import type { CatalogItem } from "@/features/recommendations";
export default async function LibraryPage() {
  let items: CatalogItem[] = [];
  try {
    items = await readUserLibrary();
  } catch {
    /* empty state */
  }
  return (
    <SiteShell title="Library">
      <h1 className="text-4xl font-bold">Your library</h1>
      <div className="mt-8">
        <CatalogGrid
          items={items}
          empty="Your library is empty. Start watching a published title."
        />
      </div>
    </SiteShell>
  );
}
