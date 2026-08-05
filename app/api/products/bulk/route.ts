import { NextResponse } from "next/server";
import { currentWorkspaceId } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import { PRODUCT_STATUSES } from "@/lib/shared";

export const dynamic = "force-dynamic";

const MAX_BATCH = 200;

/**
 * Bulk status change over selected products.
 *
 * Only status. Bulk PROMOTE is deliberately NOT here: /api/promote already owns the entitlement
 * check, the job insert, the credit charge and the rollback-on-decline, and re-implementing that
 * loop server-side would be a second billing path that can drift from the first. The client calls
 * that endpoint once per product instead — more round trips, but one implementation of the part
 * that spends money, and per-product results so it can stop cleanly when credits run out.
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
  const status = body.status as string;
  // The DB's products_status_check is the real boundary (0048) — this is the fast, clear rejection.
  if (!PRODUCT_STATUSES.includes(status as any)) {
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

  const { data, error } = await supabase
    .from("products")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("workspace_id", ws)
    .in("id", ids)
    .select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, affected: data?.length ?? 0 });
}
