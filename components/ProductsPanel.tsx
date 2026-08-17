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
  Loader2,
  RefreshCw,
  Rocket,
} from "lucide-react";
import PromoteKitDialog from "@/components/PromoteKitDialog";
import BuildProgressDialog from "@/components/BuildProgressDialog";
import ManualAddProduct from "@/components/ManualAddProduct";
import ProductStatusSelect from "@/components/ProductStatusSelect";
import CostBadge from "@/components/CostBadge";
import { useCredits } from "@/components/CreditsProvider";
import { DataTableFilter, type FilterOption } from "@/components/ui/data-table-filter";
import Pager, { pageFromParam } from "@/components/Pager";
import { PRODUCT_STATUSES, type Job, type Product } from "@/lib/shared";
import { toast } from "@/lib/toast";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead } from "@/components/ui/table";
import { cn } from "@/lib/utils";

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
  defaultStatuses,
}: {
  /** Where the pager links and the filter-reset navigate — the page hosting this panel. */
  basePath: string;
  /** What to tell someone with no products yet; differs by host page. */
  emptyHint: string;
  /** Bumped by the host page after an action of its own (a discovery run) to force a reload. */
  refreshKey?: number;
  /** Lets the host page render stat tiles / a jobs count without fetching the same data twice. */
  onData?: (d: { stats: ProductStats; openJobs: Job[] }) => void;
  /**
   * Statuses ticked on first render. A DEFAULT, not a lock — the filter chips still clear it.
   *
   * My Products uses it to mean "offers I'm actually working on": discovery writes every hit as
   * `New`, so without it that page listed 95 products of which 77 were untouched marketplace rows
   * and only 18 had a kit, burying the ones being promoted. Marketplace passes nothing and shows
   * everything, which is what discovery is for.
   */
  defaultStatuses?: string[];
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
  // The last poll failed. Almost always an expired session; the banner links to a reload rather
  // than guessing, since a transient 500 recovers on the next tick without anyone doing anything.
  const [stale, setStale] = useState(false);
  // Nothing distinguished "no products" from "haven't asked yet", so every visit flashed the
  // empty state — including on an account with 59 tracked products, which reads as data loss for
  // the second it is up. The empty state is a claim about the data; it must not be made before
  // the first response lands.
  const [loaded, setLoaded] = useState(false);
  const [statusFilters, setStatusFilters] = useState<string[]>(defaultStatuses ?? []);
  const [copied, setCopied] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  // Which products the promote dialog is about: one row, or the whole bulk selection.
  const [promoteIds, setPromoteIds] = useState<string[] | null>(null);
  // Regenerate reuses the promote dialog and the promote endpoint — it IS a build on a product
  // that already has a kit. Only the default asset selection and the wording differ.
  const [regenerate, setRegenerate] = useState(false);
  // The jobs this run queued, so the progress dialog tracks exactly what you just started rather
  // than every build in the workspace.
  const [progress, setProgress] = useState<{ jobIds: string[]; titles: Record<string, string> } | null>(null);

  const statusKey = statusFilters.join(",");
  const { refresh: refreshCredits } = useCredits();

  const load = useCallback(async () => {
    const params = new URLSearchParams({ page: String(page) });
    for (const s of statusKey ? statusKey.split(",") : []) params.append("status", s);
    // Both endpoints answer `{error}` on 401/500, and this poll runs every 5s for as long as the
    // tab is open — so a session that expires mid-session WILL hit it. Storing that object where an
    // array belongs used to crash the whole page on the next render ("A.filter is not a function"),
    // which reads as "products never load" rather than as "you were signed out". Keep the last good
    // data on screen and say what happened instead.
    const [p, j] = await Promise.all([
      fetch(`/api/products?${params}`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch("/api/jobs").then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]);
    setStale(!p || !j);
    // Set before the early return: a failed first load still means we have asked, and the stale
    // banner explains that case better than a permanent skeleton would.
    setLoaded(true);
    if (!p && !j) return;

    const jobRows: Job[] = Array.isArray(j) ? j : [];
    if (p) {
      setProducts(Array.isArray(p.rows) ? p.rows : []);
      setTotal(p.total ?? 0);
    }
    if (Array.isArray(j)) setJobs(jobRows);
    onData?.({
      stats: p?.stats ?? { total: 0, promoting: 0, selected: 0, avg_gravity: 0 },
      openJobs: jobRows.filter((x) => x.status === "pending" || x.status === "running"),
    });
    // onData is deliberately not a dependency — a host passing an inline arrow would otherwise
    // rebuild `load` every render and restart the poll interval on every tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, statusKey]);

  // Poll fast only while work is actually in flight.
  //
  // Each tick is TWO requests (/api/products and /api/jobs), and each of those pays getUser() plus
  // currentWorkspaceId() — both network round trips to Supabase — before it runs a query. That is
  // roughly eight round trips every five seconds, and neither the queries nor the payload are the
  // problem: products rows average 811 bytes and product_stats plans in 0.7 ms. The cost is purely
  // how often we ask.
  //
  // 5s while a discovery or build job is open, because that is when someone is watching a row
  // change. 30s otherwise — still picks up a teammate's changes, at a sixth of the traffic. Not
  // stopped entirely: unlike the product page, this list has other people writing to it.
  const hasOpenJobs = jobs.some((j) => j.status === "pending" || j.status === "running");
  useEffect(() => {
    load();
    const t = setInterval(load, hasOpenJobs ? 5000 : 30000);
    return () => clearInterval(t);
  }, [load, refreshKey, hasOpenJobs]);

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
    setRegenerate(false);
    setPromoteIds(buildable);
  }

  // The exact inverse of openPromote: regenerating only makes sense where a kit already exists.
  // Filtering here rather than letting /api/promote dedupe means the count in the dialog — and the
  // credit total it quotes — describes what will actually run.
  function openRegenerate(ids: string[]) {
    const withKits = ids.filter((id) => products.find((p) => p.id === id)?.campaign_status);
    if (withKits.length === 0) {
      toast.error("None of those have a kit to regenerate yet — build one first");
      return;
    }
    setRegenerate(true);
    setPromoteIds(withKits);
  }

  // Calls the SAME /api/promote the single button always used, once per product, rather than a
  // bulk endpoint — that route owns the entitlement check, the credit charge and the rollback, and
  // a second server-side copy of that loop would be a second billing path to keep in step. Stops on
  // the first failure instead of hammering: once credits run out every remaining call fails the
  // same way, and the person needs to know how far it got.
  async function runPromote(ids: string[], assets: string[], counts: Record<string, number>) {
    setBulkBusy(true);
    const jobIds: string[] = [];
    const titles: Record<string, string> = {};
    let stopped: string | null = null;
    for (const id of ids) {
      const res = await fetch("/api/promote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ product_id: id, assets, counts }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok) {
        if (d.job_id) {
          jobIds.push(d.job_id);
          titles[d.job_id] = products.find((p) => p.id === id)?.product_title ?? "Campaign kit";
        }
        continue;
      }
      stopped = d.error ?? "Something went wrong";
      break;
    }
    setBulkBusy(false);
    setPromoteIds(null);
    setSelected(new Set());
    await load();
    refreshCredits();
    // A failure still gets a toast — it's the one outcome that needs saying out loud. Success
    // doesn't: the progress dialog below IS the confirmation, and a toast on top would be noise.
    if (stopped) toast.error(`Queued ${jobIds.length}, then stopped: ${stopped}`);
    if (jobIds.length > 0) setProgress({ jobIds, titles });
  }

  function copyHoplink(p: Product) {
    if (!p.hoplink) return;
    navigator.clipboard.writeText(p.hoplink);
    setCopied(p.id);
    setTimeout(() => setCopied(null), 1500);
  }

  return (
    <>
      <Card as="section" className="overflow-hidden">
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
        {stale && (
          <div className="border-b border-ink-700 bg-amber-500/10 px-4 py-2 text-xs text-amber-300">
            Couldn&apos;t refresh this list — your session may have expired.{" "}
            <button onClick={() => window.location.reload()} className="underline">
              Reload
            </button>
          </div>
        )}
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
            <Button
              onClick={() => openPromote(Array.from(selected))}
              disabled={bulkBusy} variant="outline" className="text-xs">
              <Rocket className="h-3.5 w-3.5" /> Promote selected
              <CostBadge jobType="build_campaign" />
            </Button>
            <Button
              onClick={() => openRegenerate(Array.from(selected))}
              disabled={bulkBusy} variant="outline" className="text-xs">
              <RefreshCw className="h-3.5 w-3.5" /> Regenerate kit
              <CostBadge jobType="build_campaign" />
            </Button>
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
          <Table className="w-full text-sm">
            <TableHeader>
              <tr>
                <TableHead edge className="w-8 px-3">
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
                </TableHead>
                <TableHead>Product</TableHead>
                <TableHead>Niche</TableHead>
                <TableHead className="text-right">Gravity</TableHead>
                <TableHead className="text-right">Avg $/sale</TableHead>
                <TableHead className="text-right">Rebill</TableHead>
                <TableHead className="text-center">Score</TableHead>
                <TableHead>Status</TableHead>
                <TableHead edge className="text-right">Actions</TableHead>
              </tr>
            </TableHeader>
            <TableBody>
              {products.map((p) => (
                <TableRow key={p.id}>
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
                      <Badge className="!py-0 !px-1.5 text-[11px] uppercase tracking-wide">
                        {NETWORK_LABELS[p.network] ?? p.network}
                      </Badge>
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
                      <Button
                        onClick={() => copyHoplink(p)}
                        title="Copy hoplink" variant="outline" className="!px-2">
                        {copied === p.id ? (
                          <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </Button>
                      {p.sales_page_url && (
                        <a
                          href={p.sales_page_url}
                          target="_blank"
                          rel="noreferrer"
                          title="Open sales page"
                          className={cn(buttonVariants({ variant: "outline" }), "!px-2")}
                        >
                          <ExternalLink className="h-4 w-4" />
                        </a>
                      )}
                      {p.campaign_status === "ready" ? (
                        <Link href={`/product/${p.id}`} className={buttonVariants({ variant: "outline" })}>
                          View kit
                        </Link>
                      ) : p.campaign_status === "building" ||
                        openJobs.some(
                          (j) => j.type === "build_campaign" && j.payload.product_id === p.id
                        ) ? (
                        <span className={cn(buttonVariants({ variant: "outline" }), "pointer-events-none")}>
                          <RefreshCw className="h-4 w-4 animate-spin" /> Queued
                        </span>
                      ) : (
                        <Button
                          onClick={() => openPromote([p.id])}
                          disabled={bulkBusy}>
                          <Rocket className="h-4 w-4" /> Promote
                          <CostBadge jobType="build_campaign" />
                        </Button>
                      )}
                    </div>
                  </td>
                </TableRow>
              ))}
              {products.length === 0 && !loaded && (
                <TableRow>
                  <td colSpan={9} className="px-4 py-14 text-center">
                    <Loader2 className="mx-auto mb-2.5 h-6 w-6 animate-spin text-zinc-600" />
                    <p className="text-sm text-zinc-500">Loading products…</p>
                  </td>
                </TableRow>
              )}
              {products.length === 0 && loaded && (
                <TableRow>
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
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
        {total > 0 && (
          <div className="border-t border-ink-700 px-4 py-2.5">
            <Pager page={page} total={total} basePath={basePath} label="products" />
          </div>
        )}
      </Card>

      <BuildProgressDialog
        open={progress !== null}
        onOpenChange={(o) => !o && setProgress(null)}
        jobIds={progress?.jobIds ?? []}
        titleByJobId={progress?.titles ?? {}}
        onAllDone={load}
      />

      <PromoteKitDialog
        open={promoteIds !== null}
        onOpenChange={(o) => !o && setPromoteIds(null)}
        count={promoteIds?.length ?? 0}
        busy={bulkBusy}
        mode={regenerate ? "regenerate" : "build"}
        onConfirm={(assets, counts) => promoteIds && runPromote(promoteIds, assets, counts)}
      />
    </>
  );
}
