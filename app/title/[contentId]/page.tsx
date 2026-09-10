import { notFound } from "next/navigation";
import Link from "next/link";
import { readReadyTitle } from "@/lib/supabase/catalog";
import { SiteShell } from "@/components/shared/SiteShell";

export default async function TitlePage({ params }: { params: Promise<{ contentId: string }> }) {
  const item = await readReadyTitle((await params).contentId).catch(() => null);
  if (!item) notFound();
  return (
    <SiteShell title="Title">
      <div className="grid gap-8 lg:grid-cols-[1.2fr_.8fr]">
        <div className="aspect-video rounded-2xl bg-gradient-to-br from-violet-950 via-slate-800 to-slate-950" />
        <div>
          <p className="text-sm text-slate-400">{item.type}</p>
          <h1 className="mt-2 text-4xl font-bold">{item.title}</h1>
          <p className="mt-5 leading-7 text-slate-400">{item.synopsis ?? "Ready to watch."}</p>
          <Link
            href={`/watch/${item.id}`}
            className="mt-8 inline-block rounded-lg bg-violet-300 px-5 py-3 font-semibold text-slate-950"
          >
            Watch now
          </Link>
        </div>
      </div>
    </SiteShell>
  );
}
