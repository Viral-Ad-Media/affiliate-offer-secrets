import { NextResponse } from "next/server";
import { currentWorkspaceId, workspaceRequiredResponse } from "@/lib/workspace";
import { seoPatchFrom } from "@/lib/seo";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { renderBridgeHtml, buildHoplink } from "@/lib/engine/renderPages";
import { validatePageBlockTree } from "@/lib/engine/validatePageBlockTree";
import { isValidImageDataUrl } from "@/lib/images/validate";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  // Reject an oversized body before ever parsing it — cheap extra hardening.
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
  if (!ws) return workspaceRequiredResponse();

  const campaignId = params.id;

  // Ownership check FIRST, via the RLS-respecting user-scoped client — assert_owns_campaign
  // already exists (supabase/migrations/0008_ad_launches.sql), reused as-is.
  const { data: owns, error: ownErr } = await supabase.rpc("assert_owns_campaign", {
    p_campaign_id: campaignId,
  });
  if (ownErr || !owns) {
    return NextResponse.json({ error: "campaign not found" }, { status: 404 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  // The block-tree walker is the real validation boundary now (Phase O) — replaces the old flat
  // per-field clamp logic entirely. See lib/engine/validatePageBlockTree.ts for the full shape.
  const result = validatePageBlockTree(body, { pageKind: "bridge" });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  const tree = result.tree;

  // The "hero" embedded image is still a dedicated column (feeds Instagram posting, the
  // ad-creative fallback chain, servePublicCampaignImage) — independent of however many image
  // blocks the freeform tree itself contains. The client sends it explicitly, same as before.
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

  const { data: campaign, error: campaignErr } = await admin
    .from("campaigns")
    .select("product_id, name, cta_url, tracking")
    .eq("id", campaignId)
    .single();
  if (campaignErr || !campaign) {
    return NextResponse.json({ error: "campaign not found" }, { status: 404 });
  }

  // A hand-built funnel has no product (0068) — the same case lib/funnelSteps.ts already handles.
  // This route missed it and hard-404'd "product not found", which meant a standalone funnel's
  // opt-in page could be created and then never saved again: every edit was silently rejected.
  const { data: productRow } = campaign.product_id
    ? await admin
        .from("products")
        .select("product_title, network, vendor_id, hoplink, hoplink_override")
        .eq("id", campaign.product_id)
        .maybeSingle()
    : { data: null };
  const product = productRow ?? {
    product_title: (campaign.name as string | null) ?? "Funnel",
    network: null as string | null,
    vendor_id: "",
    hoplink: null as string | null,
    hoplink_override: null as string | null,
  };

  const { data: connection } = product.network
    ? await admin
        .from("network_connections")
        .select("affiliate_id")
        .eq("workspace_id", ws)
        .eq("network", product.network)
        .maybeSingle()
    : { data: null };

  // Only a funnel that HAS a product needs an affiliate id — that's what its hoplink is built
  // from. A standalone funnel points at campaigns.cta_url instead, so demanding a network
  // connection would block saving a page that never wanted a hoplink.
  if (product.network && !connection?.affiliate_id) {
    return NextResponse.json(
      { error: `Connect your ${product.network} affiliate ID first` },
      { status: 400 }
    );
  }

  const hoplink =
    product.network && connection?.affiliate_id
      ? buildHoplink(product.network as any, connection.affiliate_id, product.vendor_id, "page", product.hoplink_override)
      : ((campaign.cta_url as string | null) ?? "#");

  // If this campaign's funnel has added steps after opt-in (0023_funnel_steps.sql), the
  // post-submit CTA redirects to step 1 instead of revealing in place — resolved here, not
  // baked in once at step-creation time, so editing the opt-in copy never goes stale.
  const { data: firstStep } = await admin
    .from("funnel_steps")
    .select("step_index")
    .eq("campaign_id", campaignId)
    .order("step_index", { ascending: true })
    .limit(1)
    .maybeSingle();
  const nextStepUrl = firstStep
    ? `/p/${campaignId}/step/${firstStep.step_index}` // path-relative: see lib/funnelSteps.ts stepUrl()
    : null;

  const bridgeHtml = renderBridgeHtml(
    product,
    tree,
    hoplink,
    imageDataUrl,
    campaignId,
    nextStepUrl,
    (campaign.tracking ?? null) as import("@/lib/engine/renderPages").TrackingSettings | null
  );

  const { error: updateErr } = await admin
    .from("campaigns")
    .update({
      page_copy: tree,
      // Stamped so Regenerate kit can warn by date before replacing hand-written copy (0076).
      page_copy_edited_at: new Date().toISOString(),
      bridge_html: bridgeHtml,
      embedded_image_data_url: imageDataUrl,
      ...seoPatchFrom(body),
    })
    .eq("id", campaignId);

  if (updateErr) {
    return NextResponse.json({ error: "failed to save" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, bridge_html: bridgeHtml, page_copy: tree });
}
