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

  // Snapshot the WHOLE product into marketplace_product_history (0052/0053) — one row per product
  // per day. This is the only reason a "Trending" list can say anything at all, and it's stored in
  // full rather than as a bare gravity number for two reasons: payout movement is as interesting
  // as gravity movement, and the prune below deletes products that fall out of the top-N, so
  // history has to be able to describe a product the live cache no longer holds.
  //
  // Written BEFORE the prune, so a product's final day is recorded rather than lost. Best-effort:
  // a history write failing must never fail the refresh itself.
  try {
    const { data: current } = await db
      .from("marketplace_products")
      .select(
        "network, vendor_id, product_title, category, sub_category, gravity, initial_sale, avg_sale, recurring, sales_page_url"
      );
    const today = new Date().toISOString().slice(0, 10);
    // Exactly the columns selected above — narrower than CacheRow, which also carries
    // description/affiliate_page_url/fetched_at that a daily snapshot has no use for.
    type HistoryInput = Pick<
      CacheRow,
      | "network"
      | "vendor_id"
      | "product_title"
      | "category"
      | "sub_category"
      | "gravity"
      | "initial_sale"
      | "avg_sale"
      | "recurring"
      | "sales_page_url"
    >;
    const history = ((current ?? []) as HistoryInput[]).map((r) => ({ ...r, captured_on: today }));
    if (history.length > 0) {
      // Re-running the sweep on the same day overwrites that day's reading rather than erroring.
      await db
        .from("marketplace_product_history")
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

// Last-resort read from stored history: the newest snapshot we hold for each product in a
// category, regardless of age.
//
// This exists because the live fetch can fail outright — ClickBank's WAF has been observed
// blocking bursts, and a network blip is a network blip. Before this, that failure took the whole
// discovery job down and the tenant got nothing, even though the database was sitting on a
// perfectly usable picture of the marketplace from yesterday. Stale-but-real beats empty.
//
// Deliberately NOT used ahead of the live fetch: getCachedMarketplaceHits' freshness rule stands,
// because gravity drives scoring and silently serving week-old numbers as current is the failure
// this whole cache was built to avoid. This is the fallback, not the first choice — the caller
// tells the user what they're looking at.
export async function getStoredMarketplaceHits(
  payload: DiscoverPayload
): Promise<{ hits: MarketplaceHit[]; capturedOn: string | null }> {
  if (payload.mode !== "category" || !payload.category) return { hits: [], capturedOn: null };

  let q = db
    .from("marketplace_product_history")
    .select(
      "vendor_id, product_title, category, sub_category, gravity, initial_sale, avg_sale, recurring, sales_page_url, captured_on"
    )
    .eq("network", "clickbank")
    .eq("category", payload.category);
  if (payload.subCategory) q = q.eq("sub_category", payload.subCategory);

  // Newest day first, then strongest — so the de-dupe below keeps each product's latest snapshot.
  const { data, error } = await q
    .order("captured_on", { ascending: false })
    .order("gravity", { ascending: false, nullsFirst: false })
    // Enough rows to cover several days of the same products before de-duping.
    .limit(payload.count * 10);
  if (error || !data || data.length === 0) return { hits: [], capturedOn: null };

  const seen = new Set<string>();
  const latest: any[] = [];
  for (const row of data) {
    if (seen.has(row.vendor_id)) continue;
    seen.add(row.vendor_id);
    latest.push(row);
    if (latest.length >= payload.count) break;
  }
  // Re-sort by strength: the query above ordered by day first, which isn't the order a caller wants.
  latest.sort((a, b) => (b.gravity ?? 0) - (a.gravity ?? 0));

  return {
    capturedOn: latest.length > 0 ? (latest[0].captured_on as string) : null,
    hits: latest.map((r) => ({
      site: r.vendor_id as string,
      title: r.product_title as string,
      // History stores stats, not marketing copy — the description is re-fetched from the sales
      // page during verification anyway.
      description: null,
      url: (r.sales_page_url as string) ?? "",
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
      affiliateToolsUrl: null,
    })),
  };
}
