"use client";

import { useCallback, useEffect, useState } from "react";
import { Flame, TrendingUp, Plus, Check, ExternalLink, Loader2 } from "lucide-react";
import { toast } from "@/lib/toast";

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
};

type Tab = "top" | "trending";

const fmtMoney = (v: number | null) => (v == null ? "—" : `$${v.toFixed(0)}`);

// Two views over the same daily cache, answering different questions: Top is what's selling
// hardest right now, Trending is what's climbing fastest this week. Both are read-only until you
// press Add, which drops the product into your own list via the existing manual-add route — the
// same path the "Add product manually" form uses, so entitlement and validation are unchanged.
export default function MarketplaceHighlights({ onAdded }: { onAdded?: () => void }) {
  const [tab, setTab] = useState<Tab>("top");
  const [top, setTop] = useState<Highlight[]>([]);
  const [trending, setTrending] = useState<Highlight[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/marketplace/highlights");
      if (!res.ok) return;
      const data = await res.json();
      setTop(data.top ?? []);
      setTrending(data.trending ?? []);
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

  const rows = tab === "top" ? top : trending;

  return (
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-700 px-4 py-3">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setTab("top")}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${
              tab === "top" ? "bg-emerald-600 text-white" : "border border-ink-600 text-zinc-400 hover:bg-ink-700"
            }`}
          >
            <Flame className="h-3.5 w-3.5" /> Top products
          </button>
          <button
            type="button"
            onClick={() => setTab("trending")}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${
              tab === "trending"
                ? "bg-emerald-600 text-white"
                : "border border-ink-600 text-zinc-400 hover:bg-ink-700"
            }`}
          >
            <TrendingUp className="h-3.5 w-3.5" /> Trending
          </button>
        </div>
        <span className="text-xs text-zinc-500">
          {tab === "top"
            ? "Highest gravity across every category, refreshed daily"
            : "Biggest gravity gain over the last 7 days"}
        </span>
      </div>

      {loading ? (
        <p className="px-4 py-8 text-center text-sm text-zinc-500">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="px-4 py-8 text-center">
          <p className="text-sm text-zinc-400">
            {tab === "trending" ? "No trend data yet" : "No cached products yet"}
          </p>
          <p className="mt-1 text-xs text-zinc-600">
            {tab === "trending"
              ? "Trending compares gravity between daily snapshots, so it needs a couple of days of history before it can show movement. Today's snapshot is recorded."
              : "The marketplace cache refreshes daily — check back shortly."}
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-ink-800">
          {rows.map((h) => (
            <li key={`${h.network}:${h.vendor_id}`} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-zinc-100" title={h.product_title}>
                  {h.product_title}
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                  <span className="font-mono">{h.vendor_id}</span>
                  {h.sub_category || h.category ? <span>· {h.sub_category || h.category}</span> : null}
                  <span>· grav {h.gravity?.toFixed(1) ?? "—"}</span>
                  <span>· {fmtMoney(h.avg_sale)}/sale</span>
                  {h.recurring ? <span>· rebill {fmtMoney(h.recurring)}</span> : null}
                </div>
              </div>

              {tab === "trending" && h.gravity_change != null && (
                <span className="chip border-emerald-500/30 bg-emerald-500/15 text-emerald-300">
                  {/* Sign comes from the number, not a hardcoded "+" — a negative would
                      otherwise render as "+-20.0". */}
                  <TrendingUp className="h-3 w-3" />
                  {h.gravity_change > 0 ? "+" : ""}
                  {h.gravity_change.toFixed(1)}
                  {h.gravity_change_pct != null ? ` (${h.gravity_change_pct}%)` : ""}
                </span>
              )}

              <div className="flex items-center gap-1.5">
                {h.sales_page_url && (
                  <a
                    href={h.sales_page_url}
                    target="_blank"
                    rel="noreferrer"
                    title="Open sales page"
                    className="btn-ghost !px-2"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </a>
                )}
                {h.owned ? (
                  <span className="chip border-ink-600 bg-ink-800 text-zinc-400">
                    <Check className="h-3 w-3" /> Added
                  </span>
                ) : (
                  <button
                    onClick={() => add(h)}
                    disabled={adding === h.vendor_id}
                    className="btn-ghost text-xs"
                  >
                    {adding === h.vendor_id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Plus className="h-3.5 w-3.5" />
                    )}
                    Add
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
