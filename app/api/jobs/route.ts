import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { CLICKBANK_CATEGORIES } from "@/lib/categories";
import { getCachedMarketplaceHits } from "@/lib/engine/marketplaceCache";
import { upsertProduct } from "@/lib/engine/core";
import { buildHoplink } from "@/lib/engine/renderPages";
import type { DiscoverPayload } from "@/lib/engine/clickbank";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const { data: jobs, error } = await supabase
    .from("jobs")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(jobs);
}

export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const body = await req.json();
  if (body.type !== "discover_products") {
    return NextResponse.json({ error: "unknown job type" }, { status: 400 });
  }

  // Clamp to the UI's own range (max 30 in the discovery form) — the endpoint pages at 50 anyway,
  // and an unclamped crafted count would just guarantee a cache miss + oversized live fetch.
  const count = Math.min(Math.max(Number(body.count) || 10, 1), 30);
  const mode = body.mode === "keyword" ? "keyword" : "category";
  // Automated discovery only exists for ClickBank today (see lib/engine/discover.ts) — the
  // dashboard's discovery form doesn't offer a network picker yet, so this defensively defaults
  // rather than trusting client input for a value the UI doesn't actually let a user set.
  const network = "clickbank";

  const { data: connection } = await supabase
    .from("network_connections")
    .select("affiliate_id")
    .eq("user_id", user.id)
    .eq("network", network)
    .maybeSingle();
  if (!connection?.affiliate_id) {
    return NextResponse.json(
      { error: `Connect your ${network} affiliate ID first` },
      { status: 400 }
    );
  }

  let payload: Record<string, unknown>;
  if (mode === "keyword") {
    const keyword = (body.keyword ?? "").trim();
    if (!keyword) return NextResponse.json({ error: "keyword required" }, { status: 400 });
    payload = { mode: "keyword", keyword, niche: keyword, count, network };
  } else {
    const category = CLICKBANK_CATEGORIES.find((c) => c.name === body.category);
    if (!category) return NextResponse.json({ error: "unknown category" }, { status: 400 });
    const subCategory =
      body.subCategory && category.subCategories.includes(body.subCategory)
        ? body.subCategory
        : undefined;
    const niche = subCategory ? `${category.name} > ${subCategory}` : category.name;
    payload = { mode: "category", category: category.name, subCategory, niche, count, network };
  }

  // jsonb equality via PostgREST wants the JSON-encoded string as the filter value.
  const { data: open } = await supabase
    .from("jobs")
    .select("id")
    .eq("user_id", user.id)
    .eq("type", "discover_products")
    .in("status", ["pending", "running"])
    .filter("payload", "eq", JSON.stringify(payload))
    .maybeSingle();
  if (open) return NextResponse.json({ ok: true, job_id: open.id, deduped: true });

  const { data: job, error } = await supabase
    .from("jobs")
    .insert({ user_id: user.id, type: "discover_products", payload })
    .select("id")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Instant seeding from the marketplace preload cache (marketplace_products, refreshed daily —
  // see lib/engine/marketplaceCache.ts): bare product rows appear in the dashboard on the very
  // next poll instead of waiting for the engine job's own marketplace fetch. Best-effort only —
  // the queued job re-upserts the same rows idempotently and then verifies/scores them, so a
  // cache miss or a failure here costs nothing but the head start.
  let seeded = 0;
  try {
    const hits = await getCachedMarketplaceHits(payload as unknown as DiscoverPayload);
    // Concurrent, not sequential — each upsert is its own RPC round trip to hosted Postgres, and
    // distinct vendors never contend; measured sequential cost was ~1s per row.
    const results = await Promise.allSettled(
      (hits ?? []).map((hit) =>
        upsertProduct(user.id, {
          network,
          vendor_id: hit.site,
          niche: payload.niche,
          product_title: hit.title,
          description: hit.description,
          gravity: hit.marketplaceStats?.gravity ?? null,
          initial_sale: hit.marketplaceStats?.initialDollarsPerSale ?? null,
          avg_sale: hit.marketplaceStats?.averageDollarsPerSale ?? null,
          recurring: hit.marketplaceStats?.totalRebill ?? null,
          sales_page_url: hit.url,
          affiliate_page_url: hit.affiliateToolsUrl,
          hoplink: buildHoplink(network, connection.affiliate_id, hit.site, "page"),
          status: "New",
          page_verified: false,
        })
      )
    );
    seeded = results.filter((r) => r.status === "fulfilled").length;
  } catch {
    // never fail the queue over the fast path
  }

  return NextResponse.json({ ok: true, job_id: job.id, seeded });
}
