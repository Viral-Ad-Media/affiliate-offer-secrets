import { searchMarketplace, type DiscoverPayload, type MarketplaceHit } from "./clickbank";
import { CLICKBANK_CATEGORIES } from "@/lib/categories";
import { db } from "./core";

// Marketplace preload cache (marketplace_products, 0029) — see the migration header for the
// what/why. This module owns both sides: the daily refresh sweep and the cache-first read that
// lets discovery show products instantly instead of waiting on a live ClickBank round trip.

// A daily sweep + slack. Rows older than this are treated as a miss (live fetch fallback), never
// served — a cache that silently serves week-old gravity numbers is worse than a slow fetch.
const CACHE_FRESH_HOURS = 30;

// Top-N per top-level category, paged in 50s — the endpoint hard-caps every page at 50 rows
// regardless of resultsPerPage (measured live; offset paging confirmed working). 100 comfortably
// covers the discovery form's max count of 30 at the category level; a big subCategory whose
// top-30 falls outside its parent's top-100 by gravity is a cache miss that falls back to the
// live fetch, never a wrong answer.
const SWEEP_DEPTH_PER_CATEGORY = 100;
const PAGE_SIZE = 50;

// The WAF that gates this endpoint tolerates the normal discovery cadence but has been observed
// (live, during this feature's own verification) to temporarily block rapid-fire bursts — so the
// sweep is strictly sequential with a polite gap, never parallel. ~22-44 requests ≈ 30-50s total,
// under the route's maxDuration = 60. Don't raise SWEEP_DEPTH_PER_CATEGORY without rethinking
// that budget.
const SWEEP_REQUEST_GAP_MS = 300;

type CacheRow = {
  network: string;
  vendor_id: string;
  category: string | null;
  sub_category: string | null;
  product_title: string;
  description: string | null;
  gravity: number | null;
  initial_sale: number | null;
  avg_sale: number | null;
  recurring: number | null;
  sales_page_url: string | null;
  affiliate_page_url: string | null;
  fetched_at: string;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Sweeps every top-level ClickBank category into marketplace_products. Per-category failures are
// recorded and skipped (a partial refresh beats none); stale rows are pruned only after a fully
// clean sweep, so one flaky category can never mass-delete the catalog.
export async function refreshMarketplaceCache(): Promise<{
  categories: number;
  failed: string[];
  upserted: number;
  pruned: number;
}> {
  const sweepStart = new Date().toISOString();
  const failed: string[] = [];
  let upserted = 0;

  for (const cat of CLICKBANK_CATEGORIES) {
    try {
      const hits: MarketplaceHit[] = [];
      for (let offset = 0; offset < SWEEP_DEPTH_PER_CATEGORY; offset += PAGE_SIZE) {
        const page = await searchMarketplace({
          mode: "category",
          category: cat.name,
          count: PAGE_SIZE,
          offset,
        });
        hits.push(...page);
        if (page.length < PAGE_SIZE) break; // category exhausted — skip the next page's request
        await sleep(SWEEP_REQUEST_GAP_MS);
      }
      const rows = hits
        .filter((h) => h.site && h.title)
        .map((h) => ({
          network: "clickbank",
          vendor_id: h.site,
          category: h.marketplaceStats?.category ?? cat.name,
          sub_category: h.marketplaceStats?.subCategory ?? null,
          product_title: h.title,
          description: h.description,
          gravity: h.marketplaceStats?.gravity ?? null,
          initial_sale: h.marketplaceStats?.initialDollarsPerSale ?? null,
          avg_sale: h.marketplaceStats?.averageDollarsPerSale ?? null,
          recurring: h.marketplaceStats?.totalRebill ?? null,
          sales_page_url: h.url,
          affiliate_page_url: h.affiliateToolsUrl,
          fetched_at: new Date().toISOString(),
        }));
      if (rows.length > 0) {
        const { error } = await db
          .from("marketplace_products")
          .upsert(rows, { onConflict: "network,vendor_id" });
        if (error) throw new Error(error.message);
        upserted += rows.length;
      }
    } catch (err: any) {
      failed.push(`${cat.name}: ${err?.message ?? String(err)}`);
    }
    await sleep(SWEEP_REQUEST_GAP_MS);
  }

  // Snapshot today's gravity into marketplace_gravity_history (0052) — one row per product per
  // day, which is the only reason a "Trending" list can say anything at all. Done once from the
  // cache after the sweep rather than per category, so it records exactly what the cache holds.
  // Best-effort: a history write failing must never fail the refresh itself.
  try {
    const { data: current } = await db
      .from("marketplace_products")
      .select("network, vendor_id, gravity");
    const today = new Date().toISOString().slice(0, 10);
    const history = (current ?? []).map((r: { network: string; vendor_id: string; gravity: number | null }) => ({
      network: r.network,
      vendor_id: r.vendor_id,
      captured_on: today,
      gravity: r.gravity,
    }));
    if (history.length > 0) {
      // Re-running the sweep on the same day overwrites that day's reading rather than erroring.
      await db
        .from("marketplace_gravity_history")
        .upsert(history, { onConflict: "network,vendor_id,captured_on" });
    }
  } catch {
    // Swallowed on purpose — see above.
  }

  let pruned = 0;
  if (failed.length === 0) {
    const { data } = await db
      .from("marketplace_products")
      .delete()
      .eq("network", "clickbank")
      .lt("fetched_at", sweepStart)
      .select("id");
    pruned = data?.length ?? 0;
  }

  return { categories: CLICKBANK_CATEGORIES.length - failed.length, failed, upserted, pruned };
}

// Cache-first read for category-mode discovery, shaped exactly like searchMarketplace()'s return
// so callers can swap it in transparently. Returns null on any miss: keyword mode (ClickBank's
// own relevance search can't be replicated with an ilike), stale rows, or fewer cached rows than
// requested (a big subCategory whose tail fell outside its parent's top-200 sweep window) — the
// caller falls back to the live fetch it was already doing.
export async function getCachedMarketplaceHits(
  payload: DiscoverPayload
): Promise<MarketplaceHit[] | null> {
  if (payload.mode !== "category" || !payload.category) return null;

  let q = db
    .from("marketplace_products")
    .select("*")
    .eq("network", "clickbank")
    .eq("category", payload.category);
  if (payload.subCategory) q = q.eq("sub_category", payload.subCategory);

  const { data, error } = await q
    .order("gravity", { ascending: false, nullsFirst: false })
    .limit(payload.count);
  if (error || !data || data.length < payload.count) return null;

  const cutoff = Date.now() - CACHE_FRESH_HOURS * 3600_000;
  if (data.some((r: CacheRow) => new Date(r.fetched_at).getTime() < cutoff)) return null;

  return (data as CacheRow[]).map((r) => ({
    site: r.vendor_id,
    title: r.product_title,
    description: r.description,
    url: r.sales_page_url ?? "",
    marketplaceStats: {
      category: r.category,
      subCategory: r.sub_category,
      initialDollarsPerSale: r.initial_sale,
      averageDollarsPerSale: r.avg_sale,
      gravity: r.gravity,
      totalRebill: r.recurring,
      rebill: null,
      upsell: null,
    },
    affiliateToolsUrl: r.affiliate_page_url,
  }));
}
