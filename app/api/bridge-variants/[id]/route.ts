import { NextResponse } from "next/server";
import { currentWorkspaceId } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { renderBridgeHtml, buildHoplink } from "@/lib/engine/renderPages";
import { validatePageBlockTree } from "@/lib/engine/validatePageBlockTree";
import { isValidImageDataUrl } from "@/lib/images/validate";

export const dynamic = "force-dynamic";

// Identical validate/render/write shape to app/api/campaigns/[id]/page-copy/route.ts, scoped to a
// bridge_variants row instead of a campaigns row — the same PageEditor component PATCHes either
// endpoint (see its saveEndpoint prop). assert_owns_bridge_variant() already excludes control
// rows (design-review fix #1 in the split-testing plan) — a control id 404s here rather than
// silently writing content into a column nothing ever reads.

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const contentLength = Number(req.headers.get("content-length") ?? 0);
  if (contentLength > 500_000) {
    return NextResponse.json({ error: "request too large" }, { status: 413 });
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const ws = await currentWorkspaceId();

  const variantId = params.id;

  const { data: owns, error: ownErr } = await supabase.rpc("assert_owns_bridge_variant", {
    p_variant_id: variantId,
  });
  if (ownErr || !owns) {
    return NextResponse.json({ error: "variant not found" }, { status: 404 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const result = validatePageBlockTree(body, { pageKind: "bridge" });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  const tree = result.tree;

  let imageDataUrl: string | null = null;
  const rawImage = body.image_data_url;
  if (typeof rawImage === "string" && rawImage.length > 0) {
    if (!isValidImageDataUrl(rawImage)) {
      return NextResponse.json({ error: "invalid image" }, { status: 400 });
    }
    imageDataUrl = rawImage;
  } else if (rawImage !== null && rawImage !== undefined) {
    return NextResponse.json({ error: "invalid image" }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: variant, error: variantErr } = await admin
    .from("bridge_variants")
    .select("campaign_id")
    .eq("id", variantId)
    .single();
  if (variantErr || !variant) {
    return NextResponse.json({ error: "variant not found" }, { status: 404 });
  }

  const { data: campaign, error: campaignErr } = await admin
    .from("campaigns")
    .select("product_id, tracking")
    .eq("id", variant.campaign_id)
    .single();
  if (campaignErr || !campaign) {
    return NextResponse.json({ error: "campaign not found" }, { status: 404 });
  }

  const { data: product, error: productErr } = await admin
    .from("products")
    .select("product_title, network, vendor_id, hoplink, hoplink_override")
    .eq("id", campaign.product_id)
    .single();
  if (productErr || !product) {
    return NextResponse.json({ error: "product not found" }, { status: 404 });
  }

  const { data: connection } = await admin
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

  const hoplink = buildHoplink(product.network, connection.affiliate_id, product.vendor_id, "page", product.hoplink_override);

  // Variants serve at the same URL as the control, so they carry the same post-submit
  // redirect (multi-step funnels) and the same tracking snippets — part of the same gap fix as
  // rerenderFunnelSequence's variant pass (a variant page previously never picked up either).
  const { data: firstStep } = await admin
    .from("funnel_steps")
    .select("step_index")
    .eq("campaign_id", variant.campaign_id)
    .order("step_index", { ascending: true })
    .limit(1)
    .maybeSingle();
  const nextStepUrl = firstStep
    ? `/p/${variant.campaign_id}/step/${firstStep.step_index}` // path-relative: see lib/funnelSteps.ts stepUrl()
    : null;

  const bridgeHtml = renderBridgeHtml(
    product,
    tree,
    hoplink,
    imageDataUrl,
    variant.campaign_id,
    nextStepUrl,
    (campaign.tracking ?? null) as import("@/lib/engine/renderPages").TrackingSettings | null
  );

  const { error: updateErr } = await admin
    .from("bridge_variants")
    .update({
      page_copy: tree,
      bridge_html: bridgeHtml,
      embedded_image_data_url: imageDataUrl,
      updated_at: new Date().toISOString(),
    })
    .eq("id", variantId);

  if (updateErr) {
    return NextResponse.json({ error: "failed to save" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, bridge_html: bridgeHtml, page_copy: tree });
}
