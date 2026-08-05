import { NextResponse } from "next/server";
import { currentWorkspaceId } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { rerenderFunnelSequence } from "@/lib/funnelSteps";
import { isBuildable, isFunnelStart } from "@/lib/funnelTypes";
import { optInPageCopy, stepPageCopy, stepsForType } from "@/lib/funnelTemplates";
import { renderBridgeHtml, buildHoplink } from "@/lib/engine/renderPages";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Create a funnel by hand, without running an AI build.
 *
 * A funnel is still a campaign — specifically, a campaign that has bridge_html (that's what the
 * Funnels list is derived from). So this either attaches an opt-in page to the product's existing
 * campaign or creates the campaign row first; it never invents a second kind of funnel entity.
 *
 * Writes go through the admin client because campaigns' RLS is select-only for clients (closed
 * deliberately in 0009 — these columns are served raw to unauthenticated ad traffic). The
 * ownership boundary is the product lookup below, scoped to the caller's workspace before
 * anything is written; every subsequent write is keyed off ids resolved from that one row.
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
  const productId = typeof body.product_id === "string" ? body.product_id : "";
  const typeKey = typeof body.type === "string" ? body.type : "";
  const start = body.start;

  if (!productId || !isFunnelStart(start)) {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }
  // Buildable, not merely known: the picker greys out the types this app can't deliver (no video
  // block, no branching, no buyer checkout), and the API has to enforce that too — otherwise a
  // direct call creates a "webinar funnel" that is really a squeeze page with a misleading name.
  if (!isBuildable(typeKey)) {
    return NextResponse.json({ error: "that funnel type isn't available yet" }, { status: 400 });
  }
  const steps = stepsForType(typeKey) ?? [];

  const { data: product } = await supabase
    .from("products")
    .select("id, product_title, network, vendor_id, hoplink_override")
    .eq("id", productId)
    .eq("workspace_id", ws)
    .maybeSingle();
  if (!product) return NextResponse.json({ error: "product not found" }, { status: 404 });

  // The affiliate link is baked into the page at write time, so it has to exist now — not at
  // publish time. Same check and same wording as the Promote route, for the same reason.
  const { data: connection } = await supabase
    .from("network_connections")
    .select("affiliate_id")
    .eq("workspace_id", ws)
    .eq("network", product.network)
    .maybeSingle();
  if (!connection?.affiliate_id) {
    return NextResponse.json(
      { error: `Connect your ${product.network} affiliate ID first` },
      { status: 400 }
    );
  }

  const admin = createAdminClient();

  const { data: existing } = await admin
    .from("campaigns")
    .select("id, bridge_html, embedded_image_data_url, tracking")
    .eq("product_id", productId)
    .eq("workspace_id", ws)
    .maybeSingle();

  // One funnel per campaign, and one campaign per product — so a product that already has an
  // opt-in page has a funnel already. Overwriting it here would silently destroy live page copy
  // (and a running split test's control), so this refuses and points at the existing one.
  if (existing?.bridge_html) {
    return NextResponse.json(
      { error: "This product already has a funnel", campaign_id: existing.id },
      { status: 409 }
    );
  }

  const imageDataUrl = (existing?.embedded_image_data_url as string | null) ?? null;
  const pageCopy = optInPageCopy(typeKey, start, product.product_title, imageDataUrl);
  const hoplink = buildHoplink(
    product.network,
    connection.affiliate_id,
    product.vendor_id,
    "page",
    product.hoplink_override
  );

  let campaignId: string;
  if (existing) {
    campaignId = existing.id as string;
  } else {
    const { data: created, error: createErr } = await admin
      .from("campaigns")
      .insert({
        user_id: user.id,
        workspace_id: ws,
        product_id: productId,
        // 'ready' is what the public serving path gates on (alongside bridge_published), so a
        // hand-built funnel has to carry it or it could never go live. It means "this campaign
        // has something servable", not "an AI kit was generated" — the kit fields stay null and
        // the product page shows them as not generated, which is accurate.
        status: "ready",
      })
      .select("id")
      .single();
    if (createErr || !created) {
      return NextResponse.json({ error: createErr?.message ?? "failed to create" }, { status: 500 });
    }
    campaignId = created.id as string;
  }

  const bridgeHtml = renderBridgeHtml(
    product,
    pageCopy,
    hoplink,
    imageDataUrl,
    campaignId,
    null, // no steps exist yet; rerenderFunnelSequence rewrites this with the real chain below
    (existing?.tracking ?? null) as any,
    null
  );

  const { error: updErr } = await admin
    .from("campaigns")
    .update({
      page_copy: pageCopy,
      bridge_html: bridgeHtml,
      status: "ready",
      updated_at: new Date().toISOString(),
    })
    .eq("id", campaignId);
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  // Steps are inserted directly rather than through add_funnel_step(), whose ownership check is
  // still `campaigns.user_id = auth.uid()` and predates workspaces — it would reject a teammate
  // adding a step to a campaign another member created. Ownership here is already established by
  // the workspace-scoped product lookup above.
  if (steps.length > 0) {
    const rows = steps.map((stepType, i) => ({
      user_id: user.id,
      workspace_id: ws,
      campaign_id: campaignId,
      step_type: stepType,
      step_index: i + 1,
      page_copy: stepPageCopy(stepType, start, product.product_title),
      // Last step sends traffic to the offer; every earlier one continues the chain.
      cta_action: i === steps.length - 1 ? "hoplink" : "next_step",
    }));
    const { error: stepErr } = await admin.from("funnel_steps").insert(rows);
    if (stepErr) return NextResponse.json({ error: stepErr.message }, { status: 500 });
  }

  // Bakes the real hrefs: the opt-in page's redirect to step 1, and each step's own CTA.
  await rerenderFunnelSequence(admin, campaignId, ws);

  return NextResponse.json({ ok: true, campaign_id: campaignId });
}
