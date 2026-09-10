import { redirect } from "next/navigation";
import { AnalyticsRepository } from "@/lib/supabase/analytics";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import {
  displayMilliseconds,
  displayPercent,
  isAnalyticsAdmin,
  type PlaybackMetrics,
} from "@/services/telemetry/PlaybackMetrics";

export const dynamic = "force-dynamic";
export const metadata = { title: "Playback analytics | Zivora" };

function MetricCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <article className="rounded-2xl border border-slate-800 bg-slate-950/70 p-5 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">{label}</p>
      <p className="mt-3 text-3xl font-semibold tabular-nums text-slate-100">{value}</p>
      <p className="mt-2 text-sm text-slate-400">{detail}</p>
    </article>
  );
}

function QualityTable({ quality }: Pick<PlaybackMetrics, "quality">) {
  if (!quality.length)
    return (
      <p className="rounded-xl border border-dashed border-slate-700 p-5 text-sm text-slate-400">
        No quality selections have been received yet.
      </p>
    );
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-800">
      <table className="w-full min-w-[720px] text-left text-sm">
        <caption className="sr-only">
          Average selected quality by device, browser, network, and rendition
        </caption>
        <thead className="bg-slate-900 text-xs uppercase tracking-wide text-slate-400">
          <tr>
            {["Rendition", "Device", "Browser", "Network", "Selections", "Avg bandwidth"].map(
              (label) => (
                <th key={label} className="px-4 py-3 font-semibold">
                  {label}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800">
          {quality.map((row, index) => (
            <tr key={`${row.rendition_id}-${row.device}-${row.browser}-${row.network}-${index}`}>
              <td className="px-4 py-3 text-slate-100">
                {row.rendition_id ?? "Unknown"}
                {row.rendition_height ? ` · ${row.rendition_height}p` : ""}
              </td>
              <td className="px-4 py-3 text-slate-300">{row.device ?? "Unknown"}</td>
              <td className="px-4 py-3 text-slate-300">{row.browser ?? "Unknown"}</td>
              <td className="px-4 py-3 text-slate-300">{row.network ?? "Unknown"}</td>
              <td className="px-4 py-3 tabular-nums text-slate-300">
                {row.selections?.toLocaleString() ?? "—"}
              </td>
              <td className="px-4 py-3 tabular-nums text-slate-300">
                {row.average_bandwidth_estimate
                  ? `${Math.round(row.average_bandwidth_estimate / 1_000_000)} Mbps`
                  : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function AnalyticsPage() {
  const client = await createServerSupabaseClient();
  const { data } = await client.auth.getUser();
  if (!data.user || !isAnalyticsAdmin(data.user)) redirect("/");
  let metrics: PlaybackMetrics | null = null;
  try {
    metrics = await new AnalyticsRepository(createServiceSupabaseClient()).read();
  } catch {
    metrics = null;
  }
  return (
    <main className="min-h-svh bg-[#070910] px-5 py-10 text-slate-100 sm:px-8 lg:px-12">
      <header className="mx-auto max-w-6xl border-b border-slate-800 pb-7">
        <p className="text-xs font-semibold tracking-[0.2em] text-violet-300">ZIVORA · ADMIN</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">Playback health</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
          Best-effort production telemetry. Values use the latest session snapshot and refresh on
          page load.
        </p>
      </header>
      <section className="mx-auto mt-8 max-w-6xl" aria-labelledby="summary-heading">
        <h2 id="summary-heading" className="sr-only">
          Playback health summary
        </h2>
        {metrics ? (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <MetricCard
                label="Startup p50"
                value={displayMilliseconds(metrics.startup.p50_ms)}
                detail={`${metrics.startup.samples?.toLocaleString() ?? 0} sessions`}
              />
              <MetricCard
                label="Startup p95"
                value={displayMilliseconds(metrics.startup.p95_ms)}
                detail="Higher is slower"
              />
              <MetricCard
                label="Seek p50"
                value={displayMilliseconds(metrics.seek.p50_ms)}
                detail={`${metrics.seek.samples?.toLocaleString() ?? 0} measured seeks`}
              />
              <MetricCard
                label="Rebuffer ratio"
                value={displayPercent(metrics.rebuffer.ratio)}
                detail={`${metrics.rebuffer.samples?.toLocaleString() ?? 0} sessions`}
              />
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <MetricCard
                label="Playback error rate"
                value={displayPercent(metrics.errors.error_rate)}
                detail={`${metrics.errors.failed_sessions?.toLocaleString() ?? 0} failed of ${metrics.errors.sessions?.toLocaleString() ?? 0} sessions`}
              />
              <MetricCard
                label="Quality samples"
                value={metrics.quality
                  .reduce((sum, row) => sum + (row.selections ?? 0), 0)
                  .toLocaleString()}
                detail="Grouped by delivery environment"
              />
            </div>
            <section className="mt-10" aria-labelledby="quality-heading">
              <div className="mb-4">
                <h2 id="quality-heading" className="text-lg font-semibold">
                  Selected quality
                </h2>
                <p className="mt-1 text-sm text-slate-400">
                  Dimensions are coarse and exclude raw user-agent strings.
                </p>
              </div>
              <QualityTable quality={metrics.quality} />
            </section>
          </>
        ) : (
          <section
            className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-6"
            aria-live="polite"
          >
            <h2 className="font-semibold text-amber-100">Analytics are temporarily unavailable</h2>
            <p className="mt-2 text-sm leading-6 text-amber-50/80">
              Playback continues normally. Refresh this page after the analytics database is
              available.
            </p>
          </section>
        )}
      </section>
    </main>
  );
}
