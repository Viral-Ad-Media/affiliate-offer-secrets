import { NextResponse } from "next/server";
import { currentWorkspaceId } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import { PRODUCT_STATUSES } from "@/lib/shared";
import { createAdminClient } from "@/lib/supabase/admin";
import { sweepDeletedCampaignVideos } from "@/lib/supabase/campaignVideos";

export const dynamic = "force-dynamic";

const MAX_BATCH = 200;

/**
 * Bulk status change and delete over selected products.
 *
 * Only status. Bulk PROMOTE is deliberately NOT here: /api/promote already owns the entitlement
 * check, the job insert, the credit charge and the rollback-on-decline, and re-implementing that
 * loop server-side would be a second billing path that can drift from the first. The client calls
 * that endpoint once per product instead — more round trips, but one implementation of the part
 * that spends money, and per-product results so it can stop cleanly when credits run out.
 *
 * There is no ARCHIVE action here, deliberately, and no `archived_at` column. `products.status`
 * already has `Dead`, and My Products opens filtered to Selected/Promoting/Paused — so setting a
 * product Dead already IS archiving it: out of the default list, still there, one click back. A
 * second overlapping concept would give the same row two answers to "is this put away".
 *
 * DELETE is the guarded one and its blast radius is bigger than it looks: `campaigns.product_id`
 * CASCADES, so deleting a product deletes its whole campaign kit — and that in turn cascades the
 * funnel steps, split-test variants, generated creatives and ad drafts. Measured before building
 * this: 77 of 95 products are untouched discovery rows with no kit, which is exactly the mess this
 * exists to clear, but the confirmation still has to count the ones that aren't.
 *
 * Unlike the contacts and blog bulk routes, this uses the RLS-SCOPED client, not the admin client:
 * `products` RLS is `for all using (auth.uid() = user_id)`, so the policy itself restricts the
 * write and reaching for the admin client would only widen what a bug could reach. The explicit
 * workspace filter stays as the scope filter, exactly as the single-product status route does it.
 */
export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const ws = await currentWorkspaceId();
  if (!ws) return NextResponse.json({ error: "no workspace" }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const isDelete = body.action === "delete";
  const status = body.status as string;
  // The DB's products_status_check is the real boundary (0048) — this is the fast, clear rejection.
  if (!isDelete && !PRODUCT_STATUSES.includes(status as any)) {
    return NextResponse.json({ error: "unknown status" }, { status: 400 });
  }

  const raw: unknown = body.product_ids;
  if (!Array.isArray(raw) || raw.length === 0) {
    return NextResponse.json({ error: "no products selected" }, { status: 400 });
  }
  if (raw.length > MAX_BATCH) {
    return NextResponse.json({ error: `Select at most ${MAX_BATCH} products at a time` }, { status: 400 });
  }
  const ids = Array.from(new Set(raw.filter((v): v is string => typeof v === "string")));
  if (ids.length === 0) return NextResponse.json({ error: "no products selected" }, { status: 400 });

  if (isDelete) {
    if (body.confirm !== true) {
      // Never reachable from the UI without the dialog, and that is the point: an explicit flag
      // means no client can arrive here by getting an action string slightly wrong.
      return NextResponse.json({ error: "delete needs confirmation" }, { status: 400 });
    }
    // Captured BEFORE the delete: campaigns cascade from products, so afterwards there is nothing
    // left to tell us which campaigns existed — and their stored videos would be orphaned with no
    // way to find them again.
    const { data: doomed } = await supabase
      .from("products")
      .select("campaigns(id)")
      .eq("workspace_id", ws)
      .in("id", ids);
    const campaignIds = (doomed ?? [])
      .flatMap((r: any) => (Array.isArray(r.campaigns) ? r.campaigns : r.campaigns ? [r.campaigns] : []))
      .map((c: any) => c.id as string);

    const { data, error } = await supabase
      .from("products")
      .delete()
      .eq("workspace_id", ws)
      .in("id", ids)
      .select("id");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Storage is the one store no foreign key reaches. Needs the admin client — Storage has no RLS
    // policies at all (default-deny, the meta_pages shape), so the user-scoped client cannot touch
    // it. Best-effort: the products are already gone.
    let videosRemoved = 0;
    if (campaignIds.length > 0) {
      const sweep = await sweepDeletedCampaignVideos(createAdminClient(), campaignIds);
      videosRemoved = sweep.removed;
      if (sweep.failures.length > 0) {
        console.error("[products/bulk] video sweep:", sweep.failures.join("; "));
      }
    }

    return NextResponse.json({ ok: true, affected: data?.length ?? 0, videos_removed: videosRemoved });
  }

  const { data, error } = await supabase
    .from("products")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("workspace_id", ws)
    .in("id", ids)
    .select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, affected: data?.length ?? 0 });
}
