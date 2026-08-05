"use client";

import { useCallback, useEffect, useState } from "react";
import PromoteKitDialog from "@/components/PromoteKitDialog";
import { PRODUCT_STATUSES } from "@/lib/shared";
import { creditCostFor } from "@/lib/credits";
import { toast } from "@/lib/toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import JobsQueue from "@/components/JobsQueue";
import { useCredits } from "@/components/CreditsProvider";
import CostBadge from "@/components/CostBadge";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Rocket,
  Search,
  RefreshCw,
  ExternalLink,
  CheckCircle2,
  Copy,
  Package,
  Flame,
  ListChecks,
  Hourglass,
  Inbox,
} from "lucide-react";
import type { Job, Product } from "@/lib/shared";
import { CLICKBANK_CATEGORIES } from "@/lib/categories";
import ManualAddProduct from "@/components/ManualAddProduct";
import ProductStatusSelect from "@/components/ProductStatusSelect";
import MarketplaceHighlights from "@/components/MarketplaceHighlights";
import { DataTableFilter, type FilterOption } from "@/components/ui/data-table-filter";
import Pager, { pageFromParam } from "@/components/Pager";

const NETWORK_LABELS: Record<string, string> = { clickbank: "ClickBank", digistore24: "Digistore24" };

// Empty selection means "no filter applied" (show every status) — matches the old "All" pill's
// behavior without needing a literal "All" entry in the option list.
const STATUS_OPTIONS: FilterOption[] = [
  { value: "New", label: "New" },
  { value: "Selected", label: "Selected" },
  { value: "Promoting", label: "Promoting" },
  { value: "Paused", label: "Paused" },
  { value: "Dead", label: "Dead" },
];

const fmtMoney = (v: number | null) => (v == null ? "—" : `$${v.toFixed(2)}`);
const fmtNum = (v: number | null) => (v == null ? "—" : v.toFixed(1));

function StatTile({
  icon,
  label,
  value,
  sub,
  href,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  sub?: string;
  /** Makes the whole tile a link — used by "Open jobs", whose detail now lives in Settings. */
  href?: string;
}) {
  const body = (
    <div className="stat-tile">
      <div className="rounded-lg border border-ink-700 bg-ink-800 p-2.5 text-emerald-400">
        {icon}
      </div>
      <div>
        <div className="stat-tile-value">{value}</div>
        <div className="stat-tile-label">
          {label}
          {sub ? <span className="text-zinc-600"> · {sub}</span> : null}
        </div>
      </div>
    </div>
  );
  return href ? (
    <Link href={href} className="block transition-opacity hover:opacity-80">
      {body}
    </Link>
  ) : (
    body
  );
}

type ProductStats = { total: number; promoting: number; selected: number; avg_gravity: number };

export default function Marketplace() {
  const searchParams = useSearchParams();
  const router = useRouter();
  // The page number lives in the URL like every other list in this app, even though this one is a
  // client component — a Link navigation re-renders it with the new searchParams, so the pager and
  // the refresh/back-button behaviour stay identical to the server-rendered pages.
  const page = pageFromParam(searchParams.get("page") ?? undefined);

  const [products, setProducts] = useState<Product[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<ProductStats>({
    total: 0,
    promoting: 0,
    selected: 0,
    avg_gravity: 0,
  });
  const [jobs, setJobs] = useState<Job[]>([]);
  const [discoverMode, setDiscoverMode] = useState<"category" | "keyword">("category");
  const [category, setCategory] = useState(CLICKBANK_CATEGORIES[0].name);
  const [subCategory, setSubCategory] = useState("");
  const [keyword, setKeyword] = useState("");
  const [count, setCount] = useState(10);
  const [statusFilters, setStatusFilters] = useState<string[]>([]);
  const [copied, setCopied] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [jobsOpen, setJobsOpen] = useState(false);
  // Which products the promote dialog is about: one row, or the whole bulk selection.
  const [promoteIds, setPromoteIds] = useState<string[] | null>(null);

  const statusKey = statusFilters.join(",");

  const load = useCallback(async () => {
    const params = new URLSearchParams({ page: String(page) });
    for (const s of statusKey ? statusKey.split(",") : []) params.append("status", s);
    const [p, j] = await Promise.all([
      fetch(`/api/products?${params}`).then((r) => r.json()),
      fetch("/api/jobs").then((r) => r.json()),
    ]);
    setProducts(p.rows ?? []);
    setTotal(p.total ?? 0);
    if (p.stats) setStats(p.stats);
    setJobs(j);
  }, [page, statusKey]);

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  // Filtering is a server query now, so changing it has to reset to page 1 — staying on page 4 of
  // an unfiltered list while filtering down to three rows would show an empty table.
  function changeStatusFilters(next: string[]) {
    setStatusFilters(next);
    if (page !== 1) router.push("/marketplace");
  }

  const openJobs = jobs.filter((j) => j.status === "pending" || j.status === "running");

  const { refresh: refreshCredits } = useCredits();

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function bulkStatus(status: string) {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    setBulkBusy(true);
    const res = await fetch("/api/products/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, product_ids: ids }),
    });
    const data = await res.json().catch(() => ({}));
    setBulkBusy(false);
    if (!res.ok) return toast.error(data.error ?? "Something went wrong");
    toast.success(`${data.affected} product(s) set to ${status}`);
    setSelected(new Set());
    await load();
  }

  // Calls the SAME /api/promote the single button uses, once per product, rather than a bulk
  // endpoint — that route owns the entitlement check, the credit charge and the rollback, and a
  // second server-side copy of that loop would be a second billing path to keep in step. Stops on
  // the first 402 instead of hammering: once credits run out every remaining call would fail the
  // same way, and the person needs to know how far it got.
  // Both entry points — the row button and the bulk bar — open the same dialog. It's the only
  // place the asset choice is made, so the two can't offer different options.
  function openPromote(ids: string[]) {
    const buildable = ids.filter((id) => !products.find((p) => p.id === id)?.campaign_status);
    if (buildable.length === 0) {
      toast.error("Those products already have a kit or one in progress");
      return;
    }
    setPromoteIds(buildable);
  }

  // Calls the SAME /api/promote the single button always used, once per product, rather than a
  // bulk endpoint — that route owns the entitlement check, the credit charge and the rollback, and
  // a second server-side copy of that loop would be a second billing path to keep in step. Stops on
  // the first failure instead of hammering: once credits run out every remaining call fails the
  // same way, and the person needs to know how far it got.
  async function runPromote(ids: string[], assets: string[]) {
    setBulkBusy(true);
    let queued = 0;
    let stopped: string | null = null;
    for (const id of ids) {
      const res = await fetch("/api/promote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ product_id: id, assets }),
      });
      if (res.ok) {
        queued++;
        continue;
      }
      const d = await res.json().catch(() => ({}));
      stopped = d.error ?? "Something went wrong";
      break;
    }
    setBulkBusy(false);
    setPromoteIds(null);
    setSelected(new Set());
    await load();
    refreshCredits();
    if (stopped) toast.error(`Queued ${queued}, then stopped: ${stopped}`);
    else toast.success(queued === 1 ? "Kit queued" : `Queued ${queued} campaign build(s)`);
  }

  async function discover(e: React.FormEvent) {
    e.preventDefault();
    const body: Record<string, unknown> = { type: "discover_products", mode: discoverMode, count };
    if (discoverMode === "keyword") {
      if (!keyword.trim()) return;
      body.keyword = keyword.trim();
    } else {
      body.category = category;
      if (subCategory) body.subCategory = subCategory;
    }
    await fetch("/api/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    setKeyword("");
    setSubCategory("");
    await load();
    refreshCredits();
  }

  const subCategoryOptions =
    CLICKBANK_CATEGORIES.find((c) => c.name === category)?.subCategories ?? [];

  function copyHoplink(p: Product) {
    if (!p.hoplink) return;
    navigator.clipboard.writeText(p.hoplink);
    setCopied(p.id);
    setTimeout(() => setCopied(null), 1500);
  }

  return (
    <main className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-zinc-100">Marketplace</h1>
        <p className="text-sm text-zinc-400">
          Product discovery → campaign kits. Queue a job below and it starts processing
          automatically — usually within seconds.
        </p>
      </header>

      <section className="card p-4">
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

          <div className="flex flex-wrap items-center gap-2">
            {discoverMode === "category" ? (
              <>
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
              </>
            ) : (
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-zinc-500" />
                <input
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  placeholder="Keyword… e.g. weight loss"
                  className="w-64 rounded-lg border border-ink-600 bg-ink-900 py-2 pl-8 pr-3 text-sm outline-none placeholder:text-zinc-500 focus:border-emerald-500"
                />
              </div>
            )}
            <input
              type="number"
              min={1}
              max={30}
              value={count}
              onChange={(e) => setCount(Number(e.target.value) || 10)}
              title="How many products to pull"
              className="w-20 rounded-lg border border-ink-600 bg-ink-900 py-2 px-3 text-sm outline-none focus:border-emerald-500"
            />
            <button type="submit" className="btn-primary">
              <Rocket className="h-4 w-4" /> Queue discovery
              <CostBadge jobType="discover_products" />
            </button>
          </div>
        </form>
      </section>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {/* These describe every product, not just the page on screen — they come from the
            product_stats view rather than the returned rows. */}
        <StatTile icon={<Package className="h-5 w-5" />} label="Products tracked" value={stats.total} />
        <StatTile
          icon={<Flame className="h-5 w-5" />}
          label="Avg gravity"
          value={stats.avg_gravity.toFixed(1)}
        />
        <StatTile
          icon={<CheckCircle2 className="h-5 w-5" />}
          label="Promoting"
          value={stats.promoting}
          sub={`${stats.selected} selected`}
        />
        {/* The queue is something you consult when something looks stuck, not part of the
            discovery loop — so it lives behind this tile as a dialog rather than taking permanent
            space on the page or forcing a trip to Settings mid-flow. */}
        <button type="button" onClick={() => setJobsOpen(true)} className="text-left">
          <StatTile
            icon={<Hourglass className="h-5 w-5" />}
            label="Open jobs"
            value={openJobs.length}
            sub={openJobs.some((j) => j.status === "running") ? "engine running" : "view queue"}
          />
        </button>
      </section>

      {/* What the marketplace looks like today, before you've queued anything — the discovery form
          above answers "find me products in X", this answers "what should I even look at". */}
      <MarketplaceHighlights onAdded={load} />

      <section className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-ink-700 px-4 py-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
            <ListChecks className="h-4 w-4 text-emerald-400" /> Products
          </h2>
          <DataTableFilter
            label="Status"
            options={STATUS_OPTIONS}
            selectedValues={statusFilters}
            onChange={changeStatusFilters}
            isMultiSelect
          />
        </div>
        <div className="border-b border-ink-700 px-4 py-2.5">
          <ManualAddProduct onAdded={load} />
        </div>
        {selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-b border-ink-800 bg-ink-800/40 px-4 py-2">
            <span className="text-xs text-zinc-300">{selected.size} selected</span>
            <div className="h-4 w-px bg-ink-600" />
            <select
              disabled={bulkBusy}
              defaultValue=""
              onChange={(e) => {
                const v = e.target.value;
                e.target.value = "";
                if (v) bulkStatus(v);
              }}
              className="rounded border border-ink-600 bg-ink-900 px-2 py-1 text-xs text-zinc-200"
            >
              <option value="">Set status…</option>
              {PRODUCT_STATUSES.map((st) => (
                <option key={st} value={st}>
                  {st}
                </option>
              ))}
            </select>
            <button onClick={() => openPromote(Array.from(selected))} disabled={bulkBusy} className="btn-ghost text-xs">
              <Rocket className="h-3.5 w-3.5" /> Promote selected
              <CostBadge jobType="build_campaign" />
            </button>
            {bulkBusy && <RefreshCw className="h-3.5 w-3.5 animate-spin text-zinc-400" />}
            <button
              onClick={() => setSelected(new Set())}
              className="ml-auto text-xs text-zinc-500 hover:text-zinc-300"
            >
              Clear
            </button>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="data-table w-full text-sm">
            <thead>
              <tr>
                <th className="w-8 px-3">
                  <input
                    type="checkbox"
                    checked={products.length > 0 && products.every((p) => selected.has(p.id))}
                    onChange={() =>
                      setSelected(
                        products.every((p) => selected.has(p.id))
                          ? new Set()
                          : new Set(products.map((p) => p.id))
                      )
                    }
                    aria-label="Select all on this page"
                    className="accent-emerald-500"
                  />
                </th>
                <th>Product</th>
                <th>Niche</th>
                <th className="text-right">Gravity</th>
                <th className="text-right">Avg $/sale</th>
                <th className="text-right">Rebill</th>
                <th className="text-center">Score</th>
                <th>Status</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.id}>
                  <td className="px-3 py-2.5">
                    <input
                      type="checkbox"
                      checked={selected.has(p.id)}
                      onChange={() => toggle(p.id)}
                      aria-label={`Select ${p.product_title}`}
                      className="accent-emerald-500"
                    />
                  </td>
                  <td className="max-w-xs px-4 py-2.5">
                    <Link
                      href={`/product/${p.id}`}
                      className="font-medium text-zinc-100 hover:text-emerald-400"
                    >
                      {p.product_title}
                    </Link>
                    <div className="flex items-center gap-2 text-xs text-zinc-500">
                      <span className="chip !py-0 !px-1.5 text-[11px] uppercase tracking-wide">
                        {NETWORK_LABELS[p.network] ?? p.network}
                      </span>
                      <span>{p.vendor_id}</span>
                      {p.page_verified ? (
                        <span className="text-emerald-500" title="Sales page verified live">
                          ● verified
                        </span>
                      ) : (
                        <span title="Sales page not verified this run">○ unverified</span>
                      )}
                    </div>
                  </td>
                  <td className="px-2 py-2.5 text-xs text-zinc-400">{p.niche}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums">{fmtNum(p.gravity)}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums">{fmtMoney(p.avg_sale)}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums text-zinc-400">
                    {p.recurring ? fmtMoney(p.recurring) : "—"}
                  </td>
                  <td className="px-2 py-2.5 text-center">
                    <span
                      className={`inline-block h-6 w-6 rounded-md text-center text-xs font-bold leading-6 ${
                        (p.score ?? 0) >= 7
                          ? "bg-emerald-500/20 text-emerald-300"
                          : (p.score ?? 0) >= 5
                            ? "bg-amber-500/20 text-amber-300"
                            : "bg-red-500/20 text-red-300"
                      }`}
                    >
                      {p.score ?? "—"}
                    </span>
                  </td>
                  <td className="px-2 py-2.5">
                    <ProductStatusSelect productId={p.id} status={p.status} onChanged={load} />
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        onClick={() => copyHoplink(p)}
                        title="Copy hoplink"
                        className="btn-ghost !px-2"
                      >
                        {copied === p.id ? (
                          <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </button>
                      {p.sales_page_url && (
                        <a
                          href={p.sales_page_url}
                          target="_blank"
                          rel="noreferrer"
                          title="Open sales page"
                          className="btn-ghost !px-2"
                        >
                          <ExternalLink className="h-4 w-4" />
                        </a>
                      )}
                      {p.campaign_status === "ready" ? (
                        <Link href={`/product/${p.id}`} className="btn-ghost">
                          View kit
                        </Link>
                      ) : p.campaign_status === "building" ||
                        openJobs.some(
                          (j) => j.type === "build_campaign" && j.payload.product_id === p.id
                        ) ? (
                        <span className="btn-ghost pointer-events-none">
                          <RefreshCw className="h-4 w-4 animate-spin" /> Queued
                        </span>
                      ) : (
                        <button
                          onClick={() => openPromote([p.id])}
                          disabled={bulkBusy}
                          className="btn-primary"
                        >
                          <Rocket className="h-4 w-4" /> Promote
                          <CostBadge jobType="build_campaign" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {products.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-14 text-center">
                    <Inbox className="mx-auto mb-2.5 h-7 w-7 text-zinc-600" />
                    <p className="text-sm text-zinc-400">
                      {statusFilters.length === 0
                        ? "No products yet"
                        : `No ${statusFilters.map((s) => s.toLowerCase()).join(", ")} products`}
                    </p>
                    <p className="mt-1 text-xs text-zinc-600">
                      {statusFilters.length === 0
                        ? "Queue a discovery run above to get started."
                        : "Try a different status filter."}
                    </p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {total > 0 && (
          <div className="border-t border-ink-700 px-4 py-2.5">
            <Pager page={page} total={total} basePath="/marketplace" label="products" />
          </div>
        )}
      </section>
      <PromoteKitDialog
        open={promoteIds !== null}
        onOpenChange={(o) => !o && setPromoteIds(null)}
        count={promoteIds?.length ?? 0}
        busy={bulkBusy}
        onConfirm={(assets) => promoteIds && runPromote(promoteIds, assets)}
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
