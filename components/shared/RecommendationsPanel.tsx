"use client";
import { useEffect, useState } from "react";
import { CatalogGrid } from "./CatalogGrid";
import { RecommendationSchema, type Recommendation } from "@/features/recommendations";
export function RecommendationsPanel() {
  const [items, setItems] = useState<Recommendation[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "hidden">("loading");
  useEffect(() => {
    void fetch("/api/content?mode=recommendations", { credentials: "same-origin" })
      .then(async (response) => {
        if (response.status === 401) {
          setStatus("hidden");
          return;
        }
        if (!response.ok) throw new Error("unavailable");
        const value: unknown = await response.json();
        const parsed = Array.isArray((value as { results?: unknown }).results)
          ? (value as { results: unknown[] }).results.map((item) =>
              RecommendationSchema.parse(item),
            )
          : [];
        setItems(parsed);
        setStatus("ready");
      })
      .catch(() => setStatus("hidden"));
  }, []);
  if (status !== "ready" || !items.length) return null;
  return (
    <section className="mt-14">
      <h2 className="mb-5 text-2xl font-bold">Picked for you</h2>
      <CatalogGrid items={items} />
    </section>
  );
}
