"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Rocket,
  Search,
  RefreshCw,
  Trash2,
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
import { STATUS_COLORS } from "@/lib/shared";
import { CLICKBANK_CATEGORIES } from "@/lib/categories";
import ManualAddProduct from "@/components/ManualAddProduct";

const NETWORK_LABELS: Record<string, string> = { clickbank: "ClickBank", digistore24: "Digistore24" };

const fmtMoney = (v: number | null) => (v == null ? "—" : `$${v.toFixed(2)}`);
const fmtNum = (v: number | null) => (v == null ? "—" : v.toFixed(1));

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
  return (
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
}

export default function Dashboard() {
  const [products, setProducts] = useState<Product[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [discoverMode, setDiscoverMode] = useState<"category" | "keyword">("category");
  const [category, setCategory] = useState(CLICKBANK_CATEGORIES[0].name);
  const [subCategory, setSubCategory] = useState("");
  const [keyword, setKeyword] = useState("");
  const [count, setCount] = useState(10);
  const [statusFilter, setStatusFilter] = useState<string>("All");
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [p, j] = await Promise.all([
      fetch("/api/products").then((r) => r.json()),
      fetch("/api/jobs").then((r) => r.json()),
    ]);
    setProducts(p);
    setJobs(j);
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  const filtered = useMemo(
    () => (statusFilter === "All" ? products : products.filter((p) => p.status === statusFilter)),
    [products, statusFilter]
  );

  const openJobs = jobs.filter((j) => j.status === "pending" || j.status === "running");
  const avgGravity =
    products.length > 0
      ? products.reduce((s, p) => s + (p.gravity ?? 0), 0) / products.length
      : 0;

  async function promote(id: string) {
    setBusy(id);
    await fetch("/api/promote", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ product_id: id }),
    });
    await load();
    setBusy(null);
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
  }

  const subCategoryOptions =
    CLICKBANK_CATEGORIES.find((c) => c.name === category)?.subCategories ?? [];

  async function deleteJob(id: string) {
    await fetch(`/api/jobs/${id}`, { method: "DELETE" });
    await load();
  }

  function copyHoplink(p: Product) {
    if (!p.hoplink) return;
    navigator.clipboard.writeText(p.hoplink);
    setCopied(p.id);
    setTimeout(() => setCopied(null), 1500);
  }

  return (
    <main className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-zinc-100">
          ClickBank <span className="text-emerald-400">Studio</span>
        </h1>
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
            </button>
          </div>
        </form>
      </section>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile icon={<Package className="h-5 w-5" />} label="Products tracked" value={products.length} />
        <StatTile
          icon={<Flame className="h-5 w-5" />}
          label="Avg gravity"
          value={avgGravity.toFixed(1)}
        />
        <StatTile
          icon={<CheckCircle2 className="h-5 w-5" />}
          label="Promoting"
          value={products.filter((p) => p.status === "Promoting").length}
          sub={`${products.filter((p) => p.status === "Selected").length} selected`}
        />
        <StatTile
          icon={<Hourglass className="h-5 w-5" />}
          label="Open jobs"
          value={openJobs.length}
          sub={openJobs.some((j) => j.status === "running") ? "engine running" : undefined}
        />
      </section>

      <section className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-ink-700 px-4 py-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
            <ListChecks className="h-4 w-4 text-emerald-400" /> Products
          </h2>
          <div className="flex items-center gap-1 text-xs">
            {["All", "New", "Selected", "Promoting", "Paused", "Dead"].map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`rounded-full px-2.5 py-1 ${
                  statusFilter === s
                    ? "bg-emerald-600 text-white"
                    : "text-zinc-400 hover:bg-ink-700"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
        <div className="border-b border-ink-700 px-4 py-2.5">
          <ManualAddProduct onAdded={load} />
        </div>
        <div className="overflow-x-auto">
          <table className="data-table w-full text-sm">
            <thead>
              <tr>
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
              {filtered.map((p) => (
                <tr key={p.id}>
                  <td className="max-w-xs px-4 py-2.5">
                    <Link
                      href={`/product/${p.id}`}
                      className="font-medium text-zinc-100 hover:text-emerald-400"
                    >
                      {p.product_title}
                    </Link>
                    <div className="flex items-center gap-2 text-xs text-zinc-500">
                      <span className="chip !py-0 !px-1.5 text-[10px] uppercase tracking-wide">
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
                    <span className={`chip ${STATUS_COLORS[p.status] ?? STATUS_COLORS.New}`}>
                      {p.status}
                    </span>
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
                          onClick={() => promote(p.id)}
                          disabled={busy === p.id}
                          className="btn-primary"
                        >
                          <Rocket className="h-4 w-4" /> Promote
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-14 text-center">
                    <Inbox className="mx-auto mb-2.5 h-7 w-7 text-zinc-600" />
                    <p className="text-sm text-zinc-400">
                      {statusFilter === "All" ? "No products yet" : `No ${statusFilter.toLowerCase()} products`}
                    </p>
                    <p className="mt-1 text-xs text-zinc-600">
                      {statusFilter === "All"
                        ? "Queue a discovery run above to get started."
                        : "Try a different status filter."}
                    </p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <div className="flex items-center justify-between border-b border-ink-700 px-4 py-3">
          <h2 className="text-sm font-semibold text-zinc-100">Jobs queue</h2>
          <button onClick={load} className="btn-ghost !py-1 text-xs">
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </button>
        </div>
        <ul className="divide-y divide-ink-800">
          {jobs.slice(0, 12).map((j) => {
            const payload = j.payload;
            return (
              <li key={j.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                <div className="flex items-center gap-3">
                  <span
                    className={`chip ${
                      j.status === "done"
                        ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-300"
                        : j.status === "running"
                          ? "border-sky-500/30 bg-sky-500/15 text-sky-300"
                          : j.status === "error"
                            ? "border-red-500/30 bg-red-500/15 text-red-300"
                            : "border-amber-500/30 bg-amber-500/15 text-amber-300"
                    }`}
                  >
                    {j.status}
                  </span>
                  <span className="text-zinc-300">
                    {j.type === "discover_products"
                      ? `Discover: ${payload.niche}`
                      : `Build campaign: ${payload.vendor_id ?? payload.product_id}`}
                  </span>
                  {j.result && j.status === "error" && (
                    <span className="text-xs text-red-400">{j.result}</span>
                  )}
                </div>
                <div className="flex items-center gap-2 text-xs text-zinc-500">
                  <span title={j.id}>#{j.id.slice(0, 8)}</span>
                  <button
                    onClick={() => deleteJob(j.id)}
                    title="Delete job"
                    className="rounded p-1 text-zinc-500 hover:bg-ink-700 hover:text-red-400"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </li>
            );
          })}
          {jobs.length === 0 && (
            <li className="flex flex-col items-center px-4 py-8 text-center">
              <Hourglass className="mb-2 h-6 w-6 text-zinc-600" />
              <p className="text-sm text-zinc-400">No jobs yet</p>
              <p className="mt-1 text-xs text-zinc-600">
                Queued discovery and campaign jobs will show up here.
              </p>
            </li>
          )}
        </ul>
      </section>
    </main>
  );
}
