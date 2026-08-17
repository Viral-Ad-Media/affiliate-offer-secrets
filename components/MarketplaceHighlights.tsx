"use client";

import { useCallback, useEffect, useState } from "react";
import { Flame, TrendingUp, Sparkles, Plus, Check, ExternalLink, Loader2, Target, Star } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/lib/toast";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * Fourteen days of gravity as a tiny inline path.
 *
 * A single gravity number says where a product is; this says which way it's going, which is the
 * part that decides whether it's worth promoting NOW. No chart library for ~14 integers.
 *
 * Scaled to its OWN min/max, not a shared axis: these cards sit side by side at wildly different
 * gravities, and a shared scale would flatten every line but the leader's into nothing.
 */
function Spark({ values }: { values: number[] }) {
  const w = 100;
  const h = 20;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const step = values.length > 1 ? w / (values.length - 1) : w;
  const d = values
    .map((v, i) => `${i === 0 ? "M" : "L"}${(i * step).toFixed(1)},${(h - ((v - min) / span) * (h - 3) - 1.5).toFixed(1)}`)
    .join(" ");
  const rising = values[values.length - 1] >= values[0];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-5 w-full" preserveAspectRatio="none" aria-hidden>
      <path
        d={d}
        fill="none"
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
        className={rising ? "stroke-emerald-400" : "stroke-zinc-600"}
      />
    </svg>
  );
}

type Highlight = {
  network: string;
  vendor_id: string;
  product_title: string;
  category: string | null;
  sub_category: string | null;
  gravity: number | null;
  avg_sale: number | null;
  recurring: number | null;
  sales_page_url: string | null;
  owned: boolean;
  gravity_change?: number | null;
  gravity_change_pct?: number | null;
  first_seen_on?: string;
  days_known?: number;
  /** Daily gravity for the last fortnight. Null when there aren't two points to draw. */
  history?: number[] | null;
  watched?: boolean;
  gravity_at_add?: number | null;
};

type Tab = "top" | "trending" | "fresh" | "niche" | "watchlist";

const TABS: { key: Tab; label: string; icon: typeof Flame; blurb: string }[] = [
  { key: "top", label: "Top products", icon: Flame, blurb: "Highest gravity across every category, refreshed daily" },
  { key: "trending", label: "Trending", icon: TrendingUp, blurb: "Biggest gravity gain over the last 7 days" },
  { key: "fresh", label: "New", icon: Sparkles, blurb: "First seen in the marketplace within the last 7 days" },
  { key: "niche", label: "In your niches", icon: Target, blurb: "Climbing fastest in the categories you already promote" },
  { key: "watchlist", label: "Watching", icon: Star, blurb: "Products you starred, and what they've done since" },
];

const fmtMoney = (v: number | null) => (v == null ? "—" : `$${v.toFixed(0)}`);

// Three views over the stored marketplace data, answering different questions: Top is what's
// selling hardest right now, Trending is what's climbing fastest this week, New is what only just
// appeared. All read-only until you press Add, which drops the product into your own list via the
// existing manual-add route — the same path the "Add product manually" form uses, so entitlement
// and validation are unchanged.
export default function MarketplaceHighlights({ onAdded }: { onAdded?: () => void }) {
  const [tab, setTab] = useState<Tab>("top");
  const [top, setTop] = useState<Highlight[]>([]);
  const [trending, setTrending] = useState<Highlight[]>([]);
  const [niche, setNiche] = useState<Highlight[]>([]);
  const [watchlist, setWatchlist] = useState<Highlight[]>([]);
  const [starring, setStarring] = useState<string | null>(null);
  const [nicheNames, setNicheNames] = useState<string[]>([]);
  const [fresh, setFresh] = useState<Highlight[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/marketplace/highlights");
      if (!res.ok) return;
      const data = await res.json();
      setTop(data.top ?? []);
      setTrending(data.trending ?? []);
      setNiche(data.niche ?? []);
      setWatchlist(data.watchlist ?? []);
      setNicheNames(data.nicheNames ?? []);
      setFresh(data.fresh ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function add(h: Highlight) {
    setAdding(h.vendor_id);
    try {
      const res = await fetch("/api/products/manual-add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          network: h.network,
          vendor_id: h.vendor_id,
          product_title: h.product_title,
          niche: h.sub_category || h.category || "General",
          sales_page_url: h.sales_page_url ?? "",
          gravity: h.gravity,
          avg_sale: h.avg_sale,
          recurring: h.recurring,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not add that product");
      toast.success(`${h.product_title} added to your products`);
      await load();
      onAdded?.();
    } catch (err: any) {
      toast.error(err?.message ?? String(err));
    } finally {
      setAdding(null);
    }
  }

  // Direct client write: marketplace_watchlist carries a plain workspace-member policy because
  // starring a public product has no external side effect and stores no secret (the
  // network_connections case). Optimistic across every loaded tab so the star doesn't wait a
  // round trip, and reverted if the write fails.
  async function toggleWatch(h: Highlight) {
    setStarring(h.vendor_id);
    const next = !h.watched;
    const paint = (list: Highlight[]) =>
      list.map((r) => (r.vendor_id === h.vendor_id ? { ...r, watched: next } : r));
    setTop(paint); setTrending(paint); setFresh(paint); setNiche(paint);

    const supabase = createClient();
    const { error } = next
      ? await supabase.from("marketplace_watchlist").insert({
          network: h.network,
          vendor_id: h.vendor_id,
          gravity_at_add: h.gravity,
        })
      : await supabase.from("marketplace_watchlist").delete().eq("vendor_id", h.vendor_id).eq("network", h.network);

    setStarring(null);
    if (error) {
      const revert = (list: Highlight[]) =>
        list.map((r) => (r.vendor_id === h.vendor_id ? { ...r, watched: !next } : r));
      setTop(revert); setTrending(revert); setFresh(revert); setNiche(revert);
      return;
    }
    // The Watching tab is a server-derived list (it needs gravity_at_add), so refetch rather than
    // splicing — a locally-built row would be missing the movement figure the tab exists for.
    load();
  }

  const rows =
    tab === "top" ? top : tab === "trending" ? trending : tab === "niche" ? niche : tab === "watchlist" ? watchlist : fresh;
  // Reference point for the gravity bar — the strongest item currently listed.
  const topGravity = rows.reduce((m, r) => Math.max(m, r.gravity ?? 0), 0);

  return (
    <Card as="section" className="overflow-hidden">
      <div className="space-y-2 border-b border-ink-700 px-4 py-3">
        <div className="flex flex-wrap items-center gap-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${
                tab === t.key
                  ? "bg-emerald-600 text-white"
                  : "border border-ink-600 text-zinc-400 hover:bg-ink-700"
              }`}
            >
              <t.icon className="h-3.5 w-3.5" /> {t.label}
            </button>
          ))}
        </div>
        {/* Under the tabs, not beside them: at narrow widths the two competed and the blurb —
            which is what explains the difference between these three lists — lost. */}
        <p className="text-xs text-zinc-500">{TABS.find((t) => t.key === tab)?.blurb}</p>
      </div>

      {loading ? (
        <p className="px-4 py-8 text-center text-sm text-zinc-500">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="px-4 py-8 text-center">
          <p className="text-sm text-zinc-400">
            {tab === "trending"
              ? "No trend data yet"
              : tab === "fresh"
                ? "No new products yet"
                : tab === "niche"
                  ? nicheNames.length === 0
                    ? "No niches yet"
                    : "Nothing rising in your niches"
                  : tab === "watchlist"
                    ? "Nothing on your watchlist"
                  : "No cached products yet"}
          </p>
          <p className="mt-1 text-xs text-zinc-600">
            {tab === "trending"
              ? "Trending compares gravity between daily snapshots, so it needs a couple of days of history before it can show movement. Today's snapshot is recorded."
              : tab === "fresh"
                ? "A product counts as new the first time a daily sweep sees it — so this fills in from the next sweep onward. Everything present when tracking started is treated as existing, not new."
                : tab === "niche"
                  ? nicheNames.length === 0
                    ? "This list narrows Trending to the categories you already promote in. Add a product and it will start filling in."
                    : `Nothing in ${nicheNames.slice(0, 3).join(", ")}${nicheNames.length > 3 ? " (and others)" : ""} gained gravity this week. Trending shows what's moving everywhere.`
                  : tab === "watchlist"
                    ? "Star a product on any other tab to track its gravity without adding it to My Products. Useful when you want to see whether a climb holds before committing."
                  : "The marketplace cache refreshes daily — check back shortly."}
          </p>
        </div>
      ) : (
        <ul className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((h, i) => {
            // Gravity relative to the strongest item in THIS list. A raw gravity number means
            // nothing without a reference point — 42 is huge in a small subcategory and ordinary
            // in a crowded one — so the bar compares against what's actually on screen rather
            // than an absolute scale that would be wrong for both.
            const pct = topGravity > 0 ? Math.max(3, Math.round(((h.gravity ?? 0) / topGravity) * 100)) : 0;
            return (
              <li
                key={`${h.network}:${h.vendor_id}`}
                className="flex flex-col gap-3 rounded-xl border border-ink-700 bg-ink-900 p-3 transition-colors hover:border-emerald-500/40"
              >
                <div className="flex items-start gap-2.5">
                  {/* It is a leaderboard, so it should be ranked. The top three carry the accent;
                      past that the position is informative but not a recommendation. */}
                  <span
                    className={cn(
                      "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold",
                      i < 3 ? "bg-emerald-600 text-white" : "border border-ink-600 text-zinc-500"
                    )}
                  >
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    {/* Two lines' worth of space whether the title needs one or two, so the
                        metric rows line up across a grid row instead of stepping up and down. */}
                    <div
                      className="line-clamp-2 min-h-[2.5rem] text-sm font-semibold leading-snug text-zinc-100"
                      title={h.product_title}
                    >
                      {h.product_title}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      {(h.sub_category || h.category) && (
                        <Badge className="border-ink-600 bg-ink-800 text-[10px] text-zinc-400">
                          {h.sub_category || h.category}
                        </Badge>
                      )}
                      <span className="font-mono text-[10px] text-zinc-600">{h.vendor_id}</span>
                    </div>
                  </div>
                </div>

                {/* The number that decides whether this is worth promoting, given its own line and
                    a label — it used to sit mid-sentence in a run-on metadata string. */}
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div>
                    <div className="text-sm font-bold text-zinc-100">{h.gravity?.toFixed(1) ?? "—"}</div>
                    <div className="text-[10px] uppercase tracking-wide text-zinc-600">Gravity</div>
                  </div>
                  <div>
                    <div className="text-sm font-bold text-zinc-100">{fmtMoney(h.avg_sale)}</div>
                    <div className="text-[10px] uppercase tracking-wide text-zinc-600">Per sale</div>
                  </div>
                  <div>
                    <div className={cn("text-sm font-bold", h.recurring ? "text-emerald-300" : "text-zinc-600")}>
                      {h.recurring ? fmtMoney(h.recurring) : "—"}
                    </div>
                    <div className="text-[10px] uppercase tracking-wide text-zinc-600">Rebill</div>
                  </div>
                </div>

                {h.history ? (
                  <div title="Gravity over the last 14 days">
                    <Spark values={h.history} />
                  </div>
                ) : (
                  <div className="h-1 overflow-hidden rounded-full bg-ink-800" title={`${pct}% of the top product's gravity`}>
                    <div className="h-full rounded-full bg-emerald-500/70" style={{ width: `${pct}%` }} />
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-2">
                  {/* The metric that earned this row its place on THIS tab. Top needs none — the
                      rank and the bar already say it. */}
                  <div className="min-h-[1.25rem]">
                    {tab === "trending" && h.gravity_change != null && (
                      <Badge className="border-emerald-500/30 bg-emerald-500/15 text-emerald-300">
                        <TrendingUp className="h-3 w-3" />
                        {/* Sign comes from the number, not a hardcoded "+" — a negative would
                            otherwise render as "+-20.0". */}
                        {h.gravity_change > 0 ? "+" : ""}
                        {h.gravity_change.toFixed(1)} this week
                        {h.gravity_change_pct != null ? ` (${h.gravity_change_pct}%)` : ""}
                      </Badge>
                    )}
                    {tab === "watchlist" && h.gravity_change != null && (
                      <Badge
                        className={cn(
                          "border",
                          h.gravity_change >= 0
                            ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-300"
                            : "border-red-500/30 bg-red-500/15 text-red-300"
                        )}
                      >
                        {h.gravity_change > 0 ? "+" : ""}
                        {h.gravity_change.toFixed(1)} since starred
                      </Badge>
                    )}
                    {tab === "fresh" && h.days_known != null && (
                      <Badge className="border-sky-500/30 bg-sky-500/15 text-sky-300">
                        <Sparkles className="h-3 w-3" />
                        {h.days_known === 0 ? "New today" : `First seen ${h.days_known}d ago`}
                      </Badge>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => toggleWatch(h)}
                      disabled={starring === h.vendor_id}
                      aria-pressed={!!h.watched}
                      title={h.watched ? "Stop watching" : "Watch this product's gravity"}
                      className={cn(
                        buttonVariants({ variant: "outline" }),
                        "!px-2",
                        h.watched && "border-amber-500/40 text-amber-300"
                      )}
                    >
                      <Star className={cn("h-4 w-4", h.watched && "fill-current")} />
                    </button>
                    {h.sales_page_url && (
                      <a
                        href={h.sales_page_url}
                        target="_blank"
                        rel="noreferrer"
                        title="Open sales page"
                        className={cn(buttonVariants({ variant: "outline" }), "!px-2")}
                      >
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    )}
                    {h.owned ? (
                      <Badge className="border-ink-600 bg-ink-800 text-zinc-400">
                        <Check className="h-3 w-3" /> Added
                      </Badge>
                    ) : (
                      <Button onClick={() => add(h)} disabled={adding === h.vendor_id} variant="outline" className="text-xs">
                        {adding === h.vendor_id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Plus className="h-3.5 w-3.5" />
                        )}
                        Add
                      </Button>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
