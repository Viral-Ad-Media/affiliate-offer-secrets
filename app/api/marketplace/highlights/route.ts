import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const LIMIT = 12;

// Top and Trending, both read from the daily marketplace cache (0029) — no live ClickBank call, so
// the panel paints instantly and the WAF never sees extra traffic.
//
// The two lists answer genuinely different questions, which is the whole point of having both:
//   Top      — what's selling hardest RIGHT NOW (highest gravity). Proven, but crowded.
//   Trending — what's MOVING (biggest gravity gain this week, via marketplace_gravity_history +
//              the marketplace_trending view, 0052). Less proven, less competition.
//
// Trending is empty until at least two daily sweeps have recorded a reading; the response says so
// explicitly rather than falling back to a re-ranked Top list wearing a different label.
export async function GET() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const [{ data: top }, { data: trending }, { data: owned }] = await Promise.all([
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
    // So the panel can show "Added" instead of offering to add something twice.
    supabase.from("products").select("vendor_id").eq("user_id", user.id).eq("network", "clickbank"),
  ]);

  const ownedIds = new Set((owned ?? []).map((p) => p.vendor_id as string));
  const mark = <T extends { vendor_id: string }>(rows: T[] | null) =>
    (rows ?? []).map((r) => ({ ...r, owned: ownedIds.has(r.vendor_id) }));

  return NextResponse.json({
    top: mark(top as any),
    trending: mark(trending as any),
    // Null when the cache has never been swept; the UI distinguishes "no data yet" from "nothing
    // is trending".
    cachedAt: (top ?? [])[0]?.fetched_at ?? null,
  });
}
