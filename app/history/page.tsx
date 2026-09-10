import { SiteShell } from "@/components/shared/SiteShell";
import { CatalogGrid } from "@/components/shared/CatalogGrid";
import { readUserHistory } from "@/lib/supabase/catalog";
import type { CatalogItem } from "@/features/recommendations";
export default async function HistoryPage() {
  let items: CatalogItem[] = [];
  try {
    items = await readUserHistory();
  } catch {
    /* empty state */
  }
  return (
    <SiteShell title="History">
      <h1 className="text-4xl font-bold">Watch history</h1>
      <div className="mt-8">
        <CatalogGrid items={items} empty="No synced watch history yet." />
      </div>
    </SiteShell>
  );
}
