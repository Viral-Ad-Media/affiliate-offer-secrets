import { NextResponse } from "next/server";
import { currentWorkspaceId, workspaceRequiredResponse } from "@/lib/workspace";
import { seoPatchFrom } from "@/lib/seo";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { renderBridgeHtml, affiliateLink } from "@/lib/engine/renderPages";
import { validatePageBlockTree } from "@/lib/engine/validatePageBlockTree";
import { isValidImageRef } from "@/lib/images/validate";
import { uploadImageRef, uploadTreeImages, CLD_FOLDER } from "@/lib/cloudinary/upload";

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


  // The pasted affiliate link, or the funnel's own cta_url when it has no product. Saving a page
  // is never blocked on either being present — a page with nowhere to go yet is a normal state
  // while someone is still writing it, and refusing the save would strand the copy.
  const hoplink =
    affiliateLink(product.hoplink_override) || ((campaign.cta_url as string | null) ?? "#");

  // If this campaign's funnel has added steps after opt-in (0023_funnel_steps.sql), the
  // post-submit CTA redirects to step 1 instead of revealing in place — resolved here, not
  // baked in once at step-creation time, so editing the opt-in copy never goes stale.
  // All of them, not just the first: `nextStepUrl` still comes from step 1, but a form's `branch`
  // action can point one answer at any step, and it resolves ids against this list at render time.
  // Same reasoning as before — resolved on every save rather than baked once, so editing the
  // opt-in copy never leaves a stale destination.
  const { data: allSteps } = await admin
    .from("funnel_steps")
    .select("id, step_index")
    .eq("campaign_id", campaignId)
    .order("step_index", { ascending: true });
  // path-relative: see lib/funnelSteps.ts stepUrl()
  const stepLinks = (allSteps ?? []).map((s) => ({
    id: s.id as string,
    url: `/p/${campaignId}/step/${s.step_index}`,
  }));
  const nextStepUrl = stepLinks[0]?.url ?? null;

  const bridgeHtml = renderBridgeHtml(
    product,
    tree,
    hoplink,
    imageDataUrl,
    campaignId,
    nextStepUrl,
    (campaign.tracking ?? null) as import("@/lib/engine/renderPages").TrackingSettings | null,
    // seo stays unpassed here, exactly as before — rerenderFunnelSequence is what applies the
    // campaign's SEO overrides. Spelled as undefined only so `stepLinks` lands in the right slot.
    undefined,
    stepLinks
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
