import { NextResponse } from "next/server";
import { queueChargedJob } from "@/lib/credits";
import { currentWorkspaceId, workspaceRequiredResponse } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import { CLICKBANK_CATEGORIES } from "@/lib/categories";
import { getCachedMarketplaceHits } from "@/lib/engine/marketplaceCache";
import { upsertProduct } from "@/lib/engine/core";
import type { DiscoverPayload } from "@/lib/engine/clickbank";

export const dynamic = "force-dynamic";

// Every column of `jobs` EXCEPT stage_data — and that exception is the entire point.
//
// `stage_data` is where the worker parks each stage's committed output as a build advances:
// the scraped sales-page text, the base64 product image, the generated kit. Measured against the
// live table, it is ~100% of the row: jobs average 595 kB and reach 10 MB, of which payload is
// 149 bytes and result is 244. A `select("*")` here returned **32 MB** for one call; the same 50
// rows without stage_data are **12 kB**.
//
// That matters because this endpoint is POLLED — every 2s by BuildProgressDialog while a kit
// builds, every 5s by ProductsPanel while a job is open, and on the jobs page. A 32 MB response
// on a 2s timer is ~1 GB a minute per open tab, billed both from the function to the CDN and
// from the CDN to the browser.
//
// Nothing consumes it: no component reads `stage_data`, and `Job` (lib/shared.ts) doesn't even
// declare it. It is a server-side scratchpad for the worker, which reads it through its own
// service-role client, never through this route.
//
// Keep this list explicit rather than reaching back for `*`. Same rule as
// app/api/products/[id]/route.ts: a column a child component needs that is missing here is
// invisible to `tsc` and shows up as a broken UI, which is why `stage` is listed — buildProgress's
// buildSteps() derives the whole checklist from it.
const JOB_COLUMNS =
  "id, type, status, stage, payload, result, attempts, created_at, updated_at";

export async function GET() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const ws = await currentWorkspaceId();
  if (!ws) return workspaceRequiredResponse();

  const { data: jobs, error } = await supabase
    .from("jobs")
    .select(JOB_COLUMNS)
    .eq("workspace_id", ws)
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
  const ws = await currentWorkspaceId();
  if (!ws) return workspaceRequiredResponse();

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

  // No affiliate-connection gate here anymore. It existed because discovery baked a derived
  // hoplink into every row it saved; nothing derives a link now, so the check could only ever
  // block work it can no longer affect — and it is exactly the shape that took every build down
  // for two days when it and the worker disagreed about which column to scope on.

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
    .eq("workspace_id", ws)
    .eq("type", "discover_products")
    .in("status", ["pending", "running"])
    .filter("payload", "eq", JSON.stringify(payload))
    .maybeSingle();
  if (open) return NextResponse.json({ ok: true, job_id: open.id, deduped: true });

  // queue_job validates the discovery payload/network connection and commits the debit plus
  // runnable job atomically. Authenticated clients no longer have direct jobs INSERT permission.
  const queued = await queueChargedJob(supabase, {
    workspace_id: ws,
    type: "discover_products",
    payload,
  });
  if (!queued.ok) return NextResponse.json(queued.body, { status: queued.status });
  if (queued.deduped) {
    return NextResponse.json({ ok: true, job_id: queued.jobId, deduped: true });
  }

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
          hoplink: "",
          status: "New",
          page_verified: false,
        })
      )
    );
    seeded = results.filter((r) => r.status === "fulfilled").length;
  } catch {
    // never fail the queue over the fast path
  }

  return NextResponse.json({ ok: true, job_id: queued.jobId, seeded, charged: queued.charged });
}
