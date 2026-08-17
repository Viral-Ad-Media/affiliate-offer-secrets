import Link from "next/link";
import { TrendingUp, Coins, Target } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { MIN_VIEWS_FOR_RATE, type CreditRunway, type FunnelPerformance, type LeadPoint } from "@/lib/overview";

/**
 * Leads per day, drawn as an inline SVG.
 *
 * No chart library: this is one series of 30 integers, and pulling in a charting dependency to
 * draw a polyline would cost more bundle than every other component on this page combined. It is
 * also a server component this way, so the numbers arrive rendered.
 *
 * A flat line at zero is drawn honestly rather than hidden — "no leads for 30 days" is exactly the
 * thing an operator needs to see, and an empty box would let it pass unnoticed.
 */
function Sparkline({ points }: { points: LeadPoint[] }) {
  const w = 320;
  const h = 44;
  const max = Math.max(1, ...points.map((p) => p.count));
  const step = points.length > 1 ? w / (points.length - 1) : w;
  const coords = points.map((p, i) => [i * step, h - (p.count / max) * (h - 4) - 2] as const);
  const line = coords.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} L${w},${h} L0,${h} Z`;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-11 w-full" preserveAspectRatio="none" role="img"
      aria-label={`Leads per day for the last ${points.length} days`}>
      <path d={area} className="fill-emerald-500/15" />
      <path d={line} className="stroke-emerald-400" strokeWidth={1.5} fill="none" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export default function OverviewPerformance({
  runway,
  leads,
  funnels,
}: {
  runway: CreditRunway;
  leads: LeadPoint[];
  funnels: FunnelPerformance[];
}) {
  const total = leads.reduce((s, p) => s + p.count, 0);
  const low = runway.kitsAffordable !== null && runway.kitsAffordable < 1;

  return (
    <section className="grid gap-3 lg:grid-cols-3">
      {/* Credits: a balance you can act on. The bare number was already in the top bar; what it
          BUYS is the part that changes a decision. */}
      <Card className="p-4">
        <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
          <Coins className="h-3.5 w-3.5" /> Credits
        </h3>
        <p className={cn("mt-2 text-2xl font-bold", low ? "text-amber-300" : "text-zinc-100")}>
          {runway.balance.toLocaleString()}
        </p>
        <p className="mt-1 text-xs text-zinc-500">
          {runway.kitsAffordable === null
            ? "Balance available"
            : runway.kitsAffordable < 1
              ? "Not enough for another campaign kit"
              : `About ${runway.kitsAffordable} more campaign ${runway.kitsAffordable === 1 ? "kit" : "kits"}`}
        </p>
        {runway.spent30d > 0 && (
          <p className="mt-2 text-xs text-zinc-600">
            {runway.spent30d.toLocaleString()} spent in 30 days
            {runway.daysLeft !== null ? ` · ~${runway.daysLeft}d at that rate` : ""}
          </p>
        )}
      </Card>

      {/* Leads over time. */}
      <Card className="p-4">
        <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
          <TrendingUp className="h-3.5 w-3.5" /> Leads · 30 days
        </h3>
        <p className="mt-2 text-2xl font-bold text-zinc-100">{total.toLocaleString()}</p>
        <div className="mt-1">
          <Sparkline points={leads} />
        </div>
      </Card>

      {/* Best funnels. */}
      <Card className="p-4">
        <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
          <Target className="h-3.5 w-3.5" /> Best funnels
        </h3>
        {funnels.length === 0 ? (
          <p className="mt-3 text-xs text-zinc-500">
            No funnel has captured a lead yet. Publish one and point traffic at it.
          </p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {funnels.map((f) => (
              <li key={f.campaignId} className="flex items-baseline justify-between gap-2 text-xs">
                <Link href={`/funnels/${f.campaignId}`} className="min-w-0 flex-1 truncate text-zinc-300 hover:underline">
                  {f.title}
                </Link>
                <span className="shrink-0 font-semibold text-zinc-100">
                  {/* Below MIN_VIEWS_FOR_RATE no percentage is shown at all — 1 lead from 2 views
                      is 50%, which is noise wearing the costume of a result. Same gate the
                      split-test confidence card applies for the same reason. */}
                  {f.rate !== null ? `${f.rate.toFixed(1)}%` : `${f.leads} ${f.leads === 1 ? "lead" : "leads"}`}
                </span>
              </li>
            ))}
          </ul>
        )}
        {funnels.some((f) => f.rate === null) && (
          <p className="mt-2 text-[11px] text-zinc-600">
            Rates appear once a funnel passes {MIN_VIEWS_FOR_RATE} views.
          </p>
        )}
      </Card>
    </section>
  );
}
