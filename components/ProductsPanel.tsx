"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  CheckCircle2,
  Copy,
  ExternalLink,
  Inbox,
  ListChecks,
  RefreshCw,
  Rocket,
} from "lucide-react";
import PromoteKitDialog from "@/components/PromoteKitDialog";
import ManualAddProduct from "@/components/ManualAddProduct";
import ProductStatusSelect from "@/components/ProductStatusSelect";
import CostBadge from "@/components/CostBadge";
import { useCredits } from "@/components/CreditsProvider";
import { DataTableFilter, type FilterOption } from "@/components/ui/data-table-filter";
import Pager, { pageFromParam } from "@/components/Pager";
import { PRODUCT_STATUSES, type Job, type Product } from "@/lib/shared";
import { toast } from "@/lib/toast";

/**
 * The tracked-products table, with its filter, bulk bar, status editing and Promote flow.
 *
 * Shared by Marketplace (where it sits under the discovery form) and My Products (where it is the
 * whole page). Extracted rather than copied: it owns the Promote path, which charges credits — a
 * second copy would be a second billing path to keep in step, which is exactly the mistake the
 * bulk-promote loop already avoids by reusing /api/promote per product.
 */

export type ProductStats = { total: number; promoting: number; selected: number; avg_gravity: number };

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

export default function ProductsPanel({
  basePath,
  emptyHint,
  refreshKey = 0,
  onData,
}: {
  /** Where the pager links and the filter-reset navigate — the page hosting this panel. */
  basePath: string;
  /** What to tell someone with no products yet; differs by host page. */
  emptyHint: string;
  /** Bumped by the host page after an action of its own (a discovery run) to force a reload. */
  refreshKey?: number;
  /** Lets the host page render stat tiles / a jobs count without fetching the same data twice. */
  onData?: (d: { stats: ProductStats; openJobs: Job[] }) => void;
}) {
  const searchParams = useSearchParams();
  const router = useRouter();
  // The page number lives in the URL like every other list in this app, even though this is a
  // client component — a Link navigation re-renders it with the new searchParams, so the pager and
  // the refresh/back-button behaviour stay identical to the server-rendered pages.
  const page = pageFromParam(searchParams.get("page") ?? undefined);

  const [products, setProducts] = useState<Product[]>([]);
  const [total, setTotal] = useState(0);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [statusFilters, setStatusFilters] = useState<string[]>([]);
  const [copied, setCopied] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  // Which products the promote dialog is about: one row, or the whole bulk selection.
  const [promoteIds, setPromoteIds] = useState<string[] | null>(null);

  const statusKey = statusFilters.join(",");
  const { refresh: refreshCredits } = useCredits();

  const load = useCallback(async () => {
    const params = new URLSearchParams({ page: String(page) });
    for (const s of statusKey ? statusKey.split(",") : []) params.append("status", s);
    const [p, j] = await Promise.all([
      fetch(`/api/products?${params}`).then((r) => r.json()),
      fetch("/api/jobs").then((r) => r.json()),
    ]);
    setProducts(p.rows ?? []);
    setTotal(p.total ?? 0);
    setJobs(j);
    onData?.({
      stats: p.stats ?? { total: 0, promoting: 0, selected: 0, avg_gravity: 0 },
      openJobs: (j as Job[]).filter((x) => x.status === "pending" || x.status === "running"),
    });
    // onData is deliberately not a dependency — a host passing an inline arrow would otherwise
    // rebuild `load` every render and restart the poll interval on every tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, statusKey]);

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load, refreshKey]);

  // Filtering is a server query, so changing it has to reset to page 1 — staying on page 4 of an
  // unfiltered list while filtering down to three rows would show an empty table.
  function changeStatusFilters(next: string[]) {
    setStatusFilters(next);
    if (page !== 1) router.push(basePath);
  }

  const openJobs = jobs.filter((j) => j.status === "pending" || j.status === "running");

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

  function copyHoplink(p: Product) {
    if (!p.hoplink) return;
    navigator.clipboard.writeText(p.hoplink);
    setCopied(p.id);
    setTimeout(() => setCopied(null), 1500);
  }

  return (
    <>
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
            <button
              onClick={() => openPromote(Array.from(selected))}
              disabled={bulkBusy}
              className="btn-ghost text-xs"
            >
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
                  <td colSpan={9} className="px-4 py-14 text-center">
                    <Inbox className="mx-auto mb-2.5 h-7 w-7 text-zinc-600" />
                    <p className="text-sm text-zinc-400">
                      {statusFilters.length === 0
                        ? "No products yet"
                        : `No ${statusFilters.map((s) => s.toLowerCase()).join(", ")} products`}
                    </p>
                    <p className="mt-1 text-xs text-zinc-600">
                      {statusFilters.length === 0 ? emptyHint : "Try a different status filter."}
                    </p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {total > 0 && (
          <div className="border-t border-ink-700 px-4 py-2.5">
            <Pager page={page} total={total} basePath={basePath} label="products" />
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
    </>
  );
}
