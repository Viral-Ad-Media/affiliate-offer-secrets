import { NextResponse } from "next/server";
import { currentWorkspaceId, workspaceRequiredResponse } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const HISTORY_DAYS = 14;
const LIMIT = 12;

// Top and Trending, both read from the daily marketplace cache (0029) — no live ClickBank call, so
// the panel paints instantly and the WAF never sees extra traffic.
//
// The three lists answer genuinely different questions, which is the whole point of having them:
//   Top      — what's selling hardest RIGHT NOW (highest gravity). Proven, but crowded.
//   Trending — what's MOVING (biggest gravity gain this week). Less proven, less competition.
//   New      — what just APPEARED (first snapshot within the last 7 days). Earliest in, least
//              competition, least evidence.
//
// Trending and New both read from marketplace_product_history (0052/0053/0054) and are empty until
// the sweep has run at least twice — the response says so rather than falling back to a re-ranked
// Top list wearing a different label.
export async function GET() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const ws = await currentWorkspaceId();
  if (!ws) return workspaceRequiredResponse();

  const [{ data: top }, { data: trending }, { data: fresh }, { data: owned }] = await Promise.all([
    supabase
      .from("marketplace_products")
      .select("network, vendor_id, product_title, category, sub_category, gravity, avg_sale, recurring, sales_page_url, fetched_at")
      .eq("network", "clickbank")
      .order("gravity", { ascending: false, nullsFirst: false })
      .limit(LIMIT),
    supabase
      .from("marketplace_trending")
      .select("network, vendor_id, product_title, category, sub_category, gravity, avg_sale, recurring, sales_page_url, gravity_change, gravity_change_pct, first_day, last_day")
      // Risers only — a product losing gravity is real data, but it isn't "trending", and ranking
      // by change alone would leave fallers padding the bottom of the list.
      .gt("gravity_change", 0)
      // Absolute change, not percent: percent is null for low-gravity products on purpose (see
      // the view), and a +900% move off 0.1 gravity isn't a trend, it's noise.
      .order("gravity_change", { ascending: false, nullsFirst: false })
      .limit(LIMIT),
    supabase
      .from("marketplace_new_products")
      .select("network, vendor_id, product_title, category, sub_category, gravity, avg_sale, recurring, sales_page_url, first_seen_on, days_known")
      // Newest first, then strongest — among products that appeared the same day, the one already
      // pulling gravity is the more interesting one.
      .order("first_seen_on", { ascending: false })
      .order("gravity", { ascending: false, nullsFirst: false })
      .limit(LIMIT),
    // So the panel can show "Added" instead of offering to add something twice. `niche` comes
    // along because it is the category name this workspace has actually promoted in — the input
    // to the "in your niches" list below.
    supabase.from("products").select("vendor_id, niche").eq("workspace_id", ws).eq("network", "clickbank"),
  ]);

  // Watched products, joined to the CURRENT cache row so each card can show what has happened
  // since it was starred. A watched product that has since dropped out of the cache still shows —
  // its disappearance is information, not a reason to hide it.
  const { data: watchRows } = await supabase
    .from("marketplace_watchlist")
    .select("vendor_id, gravity_at_add, created_at")
    .eq("workspace_id", ws)
    .eq("network", "clickbank")
    .order("created_at", { ascending: false });

  const watchedIds = new Set((watchRows ?? []).map((w) => w.vendor_id as string));
  const { data: watchedProducts } = watchedIds.size
    ? await supabase
        .from("marketplace_products")
        .select("network, vendor_id, product_title, category, sub_category, gravity, avg_sale, recurring, sales_page_url")
        .eq("network", "clickbank")
        .in("vendor_id", Array.from(watchedIds))
    : { data: [] };

  const addedGravity = new Map((watchRows ?? []).map((w) => [w.vendor_id as string, w.gravity_at_add as number | null]));
  const watchlist = (watchedProducts ?? []).map((p: any) => {
    const at = addedGravity.get(p.vendor_id);
    return {
      ...p,
      gravity_at_add: at ?? null,
      // Movement since YOU starred it — the whole point of watching rather than adding.
      gravity_change: at != null && p.gravity != null ? Number(p.gravity) - Number(at) : null,
    };
  });

  // "Rising in your niches" — trending, narrowed to categories this workspace already works in.
  // A separate query rather than a client-side filter of `trending`: filtering the top 12 would
  // usually leave nothing, since a global riser rarely sits in one operator's handful of niches.
  const myNiches = Array.from(
    new Set(((owned ?? []) as { niche: string | null }[]).map((p) => p.niche).filter((n): n is string => !!n))
  );
  const { data: niche } = myNiches.length
    ? await supabase
        .from("marketplace_trending")
        .select(
          "network, vendor_id, product_title, category, sub_category, gravity, avg_sale, recurring, sales_page_url, gravity_change, gravity_change_pct"
        )
        .gt("gravity_change", 0)
        .in("category", myNiches)
        .order("gravity_change", { ascending: false, nullsFirst: false })
        .limit(LIMIT)
    : { data: [] };

  const ownedIds = new Set((owned ?? []).map((p) => p.vendor_id as string));

  // Gravity over the last fortnight, for the sparkline on each card. One query for every product
  // on every tab, grouped in memory — the alternative is a query per card, which at 4 tabs x 12
  // rows is 48 round trips to draw a line.
  const allIds = Array.from(
    new Set(
      [...(top ?? []), ...(trending ?? []), ...(fresh ?? []), ...(niche ?? [])].map(
        (r: any) => r.vendor_id as string
      )
    )
  );
  const since = new Date(Date.now() - HISTORY_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const { data: hist } = allIds.length
    ? await supabase
        .from("marketplace_product_history")
        .select("vendor_id, captured_on, gravity")
        .eq("network", "clickbank")
        .in("vendor_id", allIds)
        .gte("captured_on", since)
        .order("captured_on")
    : { data: [] };

  const historyByVendor = new Map<string, number[]>();
  for (const h of hist ?? []) {
    const id = h.vendor_id as string;
    const arr = historyByVendor.get(id) ?? [];
    arr.push(Number(h.gravity ?? 0));
    historyByVendor.set(id, arr);
  }

  const mark = <T extends { vendor_id: string }>(rows: T[] | null) =>
    (rows ?? []).map((r) => ({
      ...r,
      owned: ownedIds.has(r.vendor_id),
      watched: watchedIds.has(r.vendor_id),
      // Fewer than two points can't draw a trend, so send nothing and let the card omit the line
      // rather than render a dot that looks like a flat week.
      history: (historyByVendor.get(r.vendor_id) ?? []).length >= 2 ? historyByVendor.get(r.vendor_id) : null,
    }));

  return NextResponse.json({
    top: mark(top as any),
    trending: mark(trending as any),
    fresh: mark(fresh as any),
    niche: mark(niche as any),
    watchlist: mark(watchlist as any).map((w: any) => ({ ...w, watched: true })),
    watchedIds: Array.from(watchedIds),
    /** Empty is meaningful: it means this workspace has promoted nothing yet, not that nothing is rising. */
    nicheNames: myNiches,
    // Null when the cache has never been swept; the UI distinguishes "no data yet" from "nothing
    // is trending".
    cachedAt: (top ?? [])[0]?.fetched_at ?? null,
  });
}
