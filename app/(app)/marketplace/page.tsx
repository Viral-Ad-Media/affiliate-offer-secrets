"use client";

import { useState } from "react";
import { CLICKBANK_CATEGORIES } from "@/lib/categories";
import { toast } from "@/lib/toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import JobsQueue from "@/components/JobsQueue";
import { useCredits } from "@/components/CreditsProvider";
import CostBadge from "@/components/CostBadge";
import Link from "next/link";
import { Rocket, Search, CheckCircle2, Package, Flame, Hourglass, Loader2 } from "lucide-react";
import type { Job } from "@/lib/shared";
import ProductsPanel, { type ProductStats } from "@/components/ProductsPanel";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

function StatTile({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  sub?: string;
}) {
  // Value-first card, matching the Overview's band — label + icon chip up top, big tabular
  // number, optional sub-line. The whole tile can still be wrapped in a button (Open jobs).
  return (
    <div className="h-full rounded-xl border border-ink-700 bg-ink-900 p-4 transition-colors hover:border-emerald-500/50">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[11px] font-semibold uppercase tracking-wide text-zinc-500">{label}</span>
        <span className="shrink-0 rounded-md bg-emerald-500/10 p-1.5 text-emerald-400">{icon}</span>
      </div>
      <div className="mt-1.5 text-2xl font-bold tabular-nums text-zinc-100">
        {typeof value === "number" ? value.toLocaleString() : value}
      </div>
      {sub && <div className="mt-0.5 truncate text-xs text-zinc-500">{sub}</div>}
    </div>
  );
}

// Discovery lives here; the products it produces are listed by ProductsPanel, the same component
// My Products renders on its own page. The panel owns its own polling, so this page only has to
// nudge it (via refreshKey) after queueing a run, and read back the stats it already fetched.
export default function Marketplace() {
  const [discoverMode, setDiscoverMode] = useState<"category" | "keyword">("category");
  const [category, setCategory] = useState(CLICKBANK_CATEGORIES[0].name);
  const [subCategory, setSubCategory] = useState("");
  const [keyword, setKeyword] = useState("");
  const [count, setCount] = useState(10);
  const [jobsOpen, setJobsOpen] = useState(false);
  const [queueing, setQueueing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [stats, setStats] = useState<ProductStats>({
    total: 0,
    promoting: 0,
    selected: 0,
    avg_gravity: 0,
  });
  const [openJobs, setOpenJobs] = useState<Job[]>([]);

  const { refresh: refreshCredits } = useCredits();
  const load = () => setRefreshKey((k) => k + 1);

  async function discover(e: React.FormEvent) {
    e.preventDefault();
    if (queueing) return;
    const body: Record<string, unknown> = { type: "discover_products", mode: discoverMode, count };
    if (discoverMode === "keyword") {
      if (!keyword.trim()) return;
      body.keyword = keyword.trim();
    } else {
      body.category = category;
      if (subCategory) body.subCategory = subCategory;
    }
    setQueueing(true);
    const res = await fetch("/api/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    setQueueing(false);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      toast.error(d.error ?? "Could not queue discovery");
      return;
    }
    // The instant-seed path usually lands rows on the very next poll, but "usually within
    // seconds" is a claim the header makes — the confirmation should say what to watch.
    toast.success("Discovery queued — products appear in the list below as they're found");
    setKeyword("");
    setSubCategory("");
    load();
    refreshCredits();
  }

  const subCategoryOptions =
    CLICKBANK_CATEGORIES.find((c) => c.name === category)?.subCategories ?? [];

  return (
    <main className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-zinc-100">Marketplace</h1>
          <p className="text-sm text-zinc-400">
            Product discovery → campaign kits. Queue a run below and it processes automatically —
            usually within seconds. Products you already promote live on My Products.
          </p>
        </div>
        <Link href="/products" className="shrink-0 text-sm text-emerald-300 hover:text-emerald-200">
          My Products &rarr;
        </Link>
      </header>

      <Card as="section" className="p-4">
        <form onSubmit={discover} className="space-y-3">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setDiscoverMode("category")}
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                discoverMode === "category"
                  ? "bg-emerald-600 text-white"
                  : "border border-ink-600 text-zinc-400 hover:bg-ink-700"
              }`}
            >
              By category
            </button>
            <button
              type="button"
              onClick={() => setDiscoverMode("keyword")}
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                discoverMode === "keyword"
                  ? "bg-emerald-600 text-white"
                  : "border border-ink-600 text-zinc-400 hover:bg-ink-700"
              }`}
            >
              By keyword
            </button>
            <span className="ml-2 text-xs text-zinc-500">
              Categories pulled live from the ClickBank marketplace
            </span>
          </div>

          {/* Labeled, not tooltip'd: the count field's only explanation used to be a hover
              title, which is invisible until you already wonder what the box does. */}
          <div className="flex flex-wrap items-end gap-2">
            {discoverMode === "category" ? (
              <>
                <label className="block">
                  <span className="mb-1 block text-[11px] font-medium text-zinc-500">Category</span>
                  <select
                    value={category}
                    onChange={(e) => {
                      setCategory(e.target.value);
                      setSubCategory("");
                    }}
                    className="rounded-lg border border-ink-600 bg-ink-900 py-2 px-3 text-sm outline-none focus:border-emerald-500"
                  >
                    {CLICKBANK_CATEGORIES.map((c) => (
                      <option key={c.name} value={c.name}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] font-medium text-zinc-500">Subcategory</span>
                  <select
                    value={subCategory}
                    onChange={(e) => setSubCategory(e.target.value)}
                    className="rounded-lg border border-ink-600 bg-ink-900 py-2 px-3 text-sm outline-none focus:border-emerald-500"
                  >
                    <option value="">All subcategories</option>
                    {subCategoryOptions.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            ) : (
              <label className="block">
                <span className="mb-1 block text-[11px] font-medium text-zinc-500">Keyword</span>
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-zinc-500" />
                  <input
                    value={keyword}
                    onChange={(e) => setKeyword(e.target.value)}
                    placeholder="e.g. weight loss"
                    className="w-64 rounded-lg border border-ink-600 bg-ink-900 py-2 pl-8 pr-3 text-sm outline-none placeholder:text-zinc-500 focus:border-emerald-500"
                  />
                </div>
              </label>
            )}
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium text-zinc-500">Products</span>
              <input
                type="number"
                min={1}
                max={30}
                value={count}
                onChange={(e) => setCount(Number(e.target.value) || 10)}
                className="w-20 rounded-lg border border-ink-600 bg-ink-900 py-2 px-3 text-sm outline-none focus:border-emerald-500"
              />
            </label>
            <Button type="submit" disabled={queueing}>
              {queueing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
              Queue discovery
              <CostBadge jobType="discover_products" />
            </Button>
          </div>
        </form>
      </Card>


      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {/* These describe every product, not just the page on screen — they come from the
            product_stats view rather than the returned rows. */}
        <StatTile icon={<Package className="h-4 w-4" />} label="Products tracked" value={stats.total} />
        <StatTile
          icon={<Flame className="h-4 w-4" />}
          label="Avg gravity"
          value={stats.avg_gravity.toFixed(1)}
        />
        <StatTile
          icon={<CheckCircle2 className="h-4 w-4" />}
          label="Promoting"
          value={stats.promoting}
          sub={`${stats.selected} selected`}
        />
        {/* The queue is something you consult when something looks stuck, not part of the
            discovery loop — so it lives behind this tile as a dialog rather than taking permanent
            space on the page or forcing a trip to Settings mid-flow. */}
        <button type="button" onClick={() => setJobsOpen(true)} className="text-left">
          <StatTile
            icon={<Hourglass className="h-4 w-4" />}
            label="Open jobs"
            value={openJobs.length}
            sub={openJobs.some((j) => j.status === "running") ? "engine running" : "view queue"}
          />
        </button>
      </section>

      <ProductsPanel
        basePath="/marketplace"
        defaultStatuses={["New", "Selected"]}
        emptyHint="Queue a discovery run above to get started."
        refreshKey={refreshKey}
        onData={(d) => {
          setStats(d.stats);
          setOpenJobs(d.openJobs);
        }}
      />

      <Dialog open={jobsOpen} onOpenChange={setJobsOpen}>
        <DialogContent className="max-h-[85vh] max-w-[min(56rem,calc(100vw-2rem))] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Jobs queue</DialogTitle>
          </DialogHeader>
          <JobsQueue />
        </DialogContent>
      </Dialog>
    </main>
  );
}
