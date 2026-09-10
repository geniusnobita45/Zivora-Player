import "server-only";
import { z } from "zod";
import { createServerSupabaseClient } from "./server";
import { CatalogItemSchema, type CatalogItem } from "@/features/recommendations";

export async function readReadyCatalog(query = ""): Promise<CatalogItem[]> {
  const client = await createServerSupabaseClient();
  const result = await client.from("public_catalog").select("*").order("title").limit(2000);
  if (result.error) throw new Error("Catalog unavailable");
  const items = z.array(CatalogItemSchema).parse(result.data);
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return items;
  return items.filter((item) =>
    `${item.title} ${item.synopsis ?? ""}`.toLocaleLowerCase().includes(normalized),
  );
}

export async function readReadyTitle(contentId: string) {
  const id = z.string().uuid().parse(contentId);
  const items = await readReadyCatalog();
  return items.find((item) => item.id === id) ?? null;
}

export async function readUserLibrary() {
  const client = await createServerSupabaseClient();
  const auth = await client.auth.getUser();
  if (!auth.data.user) return [];
  const [progress, catalog] = await Promise.all([
    client
      .from("watch_progress")
      .select("content_id,updated_at")
      .eq("user_id", auth.data.user.id)
      .order("updated_at", { ascending: false })
      .limit(200),
    readReadyCatalog(),
  ]);
  if (progress.error) throw new Error("Library unavailable");
  const ids = new Set(progress.data.map((row) => row.content_id));
  return catalog.filter((item) => ids.has(item.id));
}

export async function readUserHistory() {
  const client = await createServerSupabaseClient();
  const auth = await client.auth.getUser();
  if (!auth.data.user) return [];
  const [history, catalog] = await Promise.all([
    client
      .from("watch_history")
      .select("content_id,updated_at")
      .eq("user_id", auth.data.user.id)
      .order("updated_at", { ascending: false })
      .limit(200),
    readReadyCatalog(),
  ]);
  if (history.error) throw new Error("History unavailable");
  const ids = new Set(history.data.map((row) => row.content_id));
  return catalog.filter((item) => ids.has(item.id));
}
