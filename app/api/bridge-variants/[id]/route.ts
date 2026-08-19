import { NextResponse } from "next/server";
import { variantNextStepUrl } from "@/lib/funnelSteps";
import { currentWorkspaceId, workspaceRequiredResponse } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { renderBridgeHtml, affiliateLink } from "@/lib/engine/renderPages";
import { validatePageBlockTree } from "@/lib/engine/validatePageBlockTree";
import { isValidImageRef } from "@/lib/images/validate";
import { uploadImageRef, uploadTreeImages, CLD_FOLDER } from "@/lib/cloudinary/upload";

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
  if (!ws) return workspaceRequiredResponse();

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
    if (!isValidImageRef(rawImage)) {
      return NextResponse.json({ error: "invalid image" }, { status: 400 });
    }
    imageDataUrl = rawImage;
  } else if (rawImage !== null && rawImage !== undefined) {
    return NextResponse.json({ error: "invalid image" }, { status: 400 });
  }

  const admin = createAdminClient();

  // Images move to Cloudinary BEFORE anything is rendered or stored. bridge_html is baked at write
  // time, so uploading after the render would leave the served page carrying base64 while page_copy
  // claimed the image lived elsewhere — the two would disagree about the same page.
  //
  // The hero column is uploaded separately from the tree because it is a separate value with its
  // own consumers (Instagram posting, the ad-creative fallback chain, servePublicCampaignImage).
  await uploadTreeImages(admin, tree, CLD_FOLDER.page, { workspaceId: ws, userId: user.id });
  imageDataUrl = await uploadImageRef(admin, imageDataUrl, CLD_FOLDER.campaign, {
    workspaceId: ws,
    userId: user.id,
  });

  const { data: variant, error: variantErr } = await admin
    .from("bridge_variants")
    .select("campaign_id, next_action, next_url, next_step_id")
    .eq("id", variantId)
    .single();
  if (variantErr || !variant) {
    return NextResponse.json({ error: "variant not found" }, { status: 404 });
  }

  const { data: campaign, error: campaignErr } = await admin
    .from("campaigns")
    .select("product_id, name, cta_url, tracking")
    .eq("id", variant.campaign_id)
    .single();
  if (campaignErr || !campaign) {
    return NextResponse.json({ error: "campaign not found" }, { status: 404 });
  }

  // Same standalone-funnel case as the page-copy route: no product means no hoplink, not an error.
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

  // The pasted affiliate link, or the funnel's own cta_url when it has no product. Saving a page
  // is never blocked on either being present — a page with nowhere to go yet is a normal state
  // while someone is still writing it, and refusing the save would strand the copy.
  const hoplink =
    affiliateLink(product.hoplink_override) || ((campaign.cta_url as string | null) ?? "#");

  // Variants serve at the same URL as the control, so they carry the same post-submit
  // redirect (multi-step funnels) and the same tracking snippets — part of the same gap fix as
  // rerenderFunnelSequence's variant pass (a variant page previously never picked up either).
  // All steps, not just the first — a variant can carry a branching form exactly as the control
  // can, and a branch resolves step ids against this list.
  const { data: allSteps } = await admin
    .from("funnel_steps")
    .select("id, step_index")
    .eq("campaign_id", variant.campaign_id)
    .order("step_index", { ascending: true });
  // path-relative: see lib/funnelSteps.ts stepUrl()
  const stepLinks = (allSteps ?? []).map((s) => ({
    id: s.id as string,
    url: `/p/${variant.campaign_id}/step/${s.step_index}`,
  }));
  // Per-variant flow (0115): this page's own destination, not blindly the funnel's first step.
  const nextStepUrl = variantNextStepUrl(
    variant as any,
    (allSteps ?? []) as { id: string; step_index: number }[],
    variant.campaign_id as string,
    stepLinks[0]?.url ?? null
  );

  const bridgeHtml = renderBridgeHtml(
    product,
    tree,
    hoplink,
    imageDataUrl,
    variant.campaign_id,
    nextStepUrl,
    (campaign.tracking ?? null) as import("@/lib/engine/renderPages").TrackingSettings | null,
    // seo unpassed, as before — only positional so stepLinks lands correctly.
    undefined,
    stepLinks
  );

  const { error: updateErr } = await admin
    .from("bridge_variants")
    .update({
      page_copy: tree,
      // Stamped so Regenerate kit can warn by date before replacing hand-written copy (0076).
      page_copy_edited_at: new Date().toISOString(),
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
