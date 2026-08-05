import { NextResponse } from "next/server";
import { currentWorkspaceId, workspaceRequiredResponse } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import { PAGE_SIZE, pageRange } from "@/components/Pager";
import { PRODUCT_STATUSES } from "@/lib/shared";

export const dynamic = "force-dynamic";

// Paged, not "everything". The Marketplace page polls this every 5s, so returning the tenant's
// whole catalogue meant the payload grew forever as they discovered more products. Stats come from
// the product_stats view (0050) instead of being derived from the returned rows, which is what
// makes the list pageable at all — the tiles still describe ALL products, not just this page.
export async function GET(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const ws = await currentWorkspaceId();
  if (!ws) return workspaceRequiredResponse();

  const url = new URL(req.url);
  const rawPage = Number.parseInt(url.searchParams.get("page") ?? "1", 10);
  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
  // Status filtering moved server-side along with the paging — filtering one page client-side
  // would silently hide matches that live on other pages.
  const statuses = url.searchParams
    .getAll("status")
    .filter((s) => (PRODUCT_STATUSES as readonly string[]).includes(s));

  const scoped = () => {
    const q = supabase
      .from("products")
      .select("*, campaigns(id, status)", { count: "exact" })
      .eq("workspace_id", ws);
    return statuses.length > 0 ? q.in("status", statuses) : q;
  };

  // Count first, so the page can be clamped before the range query runs: PostgREST answers a range
  // that starts past the end with a 416, not an empty list. That's reachable in normal use — sit on
  // page 2, delete rows until fewer than one page remains, and the 5s poll would start erroring.
  const [{ count: matching }, { data: stats }] = await Promise.all([
    scoped().limit(0),
    supabase
      .from("product_stats")
      .select("total, promoting, selected, avg_gravity")
      .eq("workspace_id", ws)
      .maybeSingle(),
  ]);

  const total = matching ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(page, lastPage);
  const [from, to] = pageRange(safePage, PAGE_SIZE);

  const { data: products, error } =
    total === 0
      ? { data: [], error: null }
      : await scoped()
          .order("score", { ascending: false, nullsFirst: false })
          .order("gravity", { ascending: false, nullsFirst: false })
          // Two products can tie on both score and gravity; without a unique tiebreaker the same
          // row can appear on two pages, or on none.
          .order("id", { ascending: false })
          .range(from, to);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (products ?? []).map((p: any) => {
    const { campaigns, ...rest } = p;
    const campaign = Array.isArray(campaigns) ? campaigns[0] : campaigns;
    return { ...rest, campaign_id: campaign?.id ?? null, campaign_status: campaign?.status ?? null };
  });

  return NextResponse.json({
    rows,
    // Rows matching the current filter — that's what the pager counts.
    total,
    // The page actually served, which may be lower than the one asked for.
    page: safePage,
    // A tenant with zero products has no product_stats row at all, hence the zeros.
    stats: stats ?? { total: 0, promoting: 0, selected: 0, avg_gravity: 0 },
  });
}
