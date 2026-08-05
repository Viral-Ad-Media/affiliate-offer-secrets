import { NextResponse } from "next/server";
import { currentWorkspaceId } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isValidRedirectUrl } from "@/lib/validate";
import { rerenderFunnelSequence } from "@/lib/funnelSteps";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Set or clear a product's affiliate-link override.
 *
 * The link is BAKED into stored HTML — bridge pages, variants and every funnel step have their
 * hrefs resolved at write time, not at serve time (see lib/funnelSteps.ts). So changing it here is
 * only half the job: without the re-render below, published pages would keep sending real paid
 * traffic to the old link indefinitely while the UI claimed otherwise.
 *
 * `products` RLS is `for all` (unlike campaigns' select-only), so this uses the RLS-scoped client
 * for the write — the policy already restricts it to the caller's own rows, and reaching for the
 * admin client would only widen what a bug here could touch. The workspace filter is belt and
 * braces, matching how every other query in this app is written.
 */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const ws = await currentWorkspaceId();
  if (!ws) return NextResponse.json({ error: "no workspace" }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const raw = typeof body.hoplink_override === "string" ? body.hoplink_override.trim() : null;

  // Empty string means "clear it and go back to the derived link" — a distinct, intentional action,
  // not a validation failure.
  const override = raw ? raw : null;
  if (override && !isValidRedirectUrl(override)) {
    return NextResponse.json(
      { error: "Enter a full link starting with http:// or https://" },
      { status: 400 }
    );
  }

  const { data: updated, error } = await supabase
    .from("products")
    .update({ hoplink_override: override, updated_at: new Date().toISOString() })
    .eq("id", params.id)
    .eq("workspace_id", ws)
    .select("id, hoplink_override");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!updated || updated.length === 0) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Re-render every funnel built from this product so live pages point at the new link. Failures
  // are collected rather than thrown: the override IS saved at this point, and reporting "couldn't
  // save" because one campaign's re-render failed would be a lie that invites a destructive retry.
  const admin = createAdminClient();
  const { data: campaigns } = await admin
    .from("campaigns")
    .select("id")
    .eq("workspace_id", ws)
    .eq("product_id", params.id);

  let rerendered = 0;
  const failed: string[] = [];
  for (const c of campaigns ?? []) {
    try {
      await rerenderFunnelSequence(admin, c.id as string, ws);
      rerendered++;
    } catch (err: any) {
      failed.push(c.id as string);
      console.error(`[hoplink] re-render failed for campaign ${c.id}:`, err?.message ?? err);
    }
  }

  return NextResponse.json({
    ok: true,
    hoplink_override: updated[0].hoplink_override,
    rerendered,
    // Surfaced so the UI can say "saved, but N pages still show the old link" rather than implying
    // everything is consistent when it isn't.
    failed_campaigns: failed.length,
  });
}
