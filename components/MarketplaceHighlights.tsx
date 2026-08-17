"use client";

import { useCallback, useEffect, useState } from "react";
import { Flame, TrendingUp, Sparkles, Plus, Check, ExternalLink, Loader2 } from "lucide-react";
import { toast } from "@/lib/toast";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

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
};

type Tab = "top" | "trending" | "fresh";

const TABS: { key: Tab; label: string; icon: typeof Flame; blurb: string }[] = [
  { key: "top", label: "Top products", icon: Flame, blurb: "Highest gravity across every category, refreshed daily" },
  { key: "trending", label: "Trending", icon: TrendingUp, blurb: "Biggest gravity gain over the last 7 days" },
  { key: "fresh", label: "New", icon: Sparkles, blurb: "First seen in the marketplace within the last 7 days" },
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

  const rows = tab === "top" ? top : tab === "trending" ? trending : fresh;
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
                : "No cached products yet"}
          </p>
          <p className="mt-1 text-xs text-zinc-600">
            {tab === "trending"
              ? "Trending compares gravity between daily snapshots, so it needs a couple of days of history before it can show movement. Today's snapshot is recorded."
              : tab === "fresh"
                ? "A product counts as new the first time a daily sweep sees it — so this fills in from the next sweep onward. Everything present when tracking started is treated as existing, not new."
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

                <div className="h-1 overflow-hidden rounded-full bg-ink-800" title={`${pct}% of the top product's gravity`}>
                  <div className="h-full rounded-full bg-emerald-500/70" style={{ width: `${pct}%` }} />
                </div>

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
                    {tab === "fresh" && h.days_known != null && (
                      <Badge className="border-sky-500/30 bg-sky-500/15 text-sky-300">
                        <Sparkles className="h-3 w-3" />
                        {h.days_known === 0 ? "New today" : `First seen ${h.days_known}d ago`}
                      </Badge>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5">
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
