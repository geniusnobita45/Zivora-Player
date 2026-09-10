import { readReadyCatalog } from "@/lib/supabase/catalog";
import { CatalogGrid } from "@/components/shared/CatalogGrid";
import { SiteShell } from "@/components/shared/SiteShell";
import { RecommendationsPanel } from "@/components/shared/RecommendationsPanel";
import type { CatalogItem } from "@/features/recommendations";
export default async function BrowsePage() {
  let items: CatalogItem[] = [];
  try {
    items = await readReadyCatalog();
  } catch {
    /* empty state keeps marketing browse available */
  }
  return (
    <SiteShell title="Browse">
      <h1 className="mb-8 text-4xl font-bold">Find something to watch</h1>
      <CatalogGrid items={items} empty="No published titles are available yet." />
      <RecommendationsPanel />
    </SiteShell>
  );
}
