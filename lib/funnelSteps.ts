import type { SupabaseClient } from "@supabase/supabase-js";
import {
  renderBridgeHtml,
  renderFunnelStepHtml,
  buildHoplink,
  type PageCopy,
  type FunnelStepType,
} from "@/lib/engine/renderPages";

type FunnelStepRow = {
  id: string;
  step_type: FunnelStepType;
  step_index: number;
  page_copy: PageCopy | null;
  embedded_image_data_url: string | null;
  cta_action: "next_step" | "hoplink";
  target_product_id: string | null;
};

function stepUrl(campaignId: string, stepIndex: number): string {
  return `${process.env.NEXT_PUBLIC_APP_URL}/p/${campaignId}/step/${stepIndex}`;
}

// Re-renders campaigns.bridge_html (its post-opt-in redirect target) and every funnel_steps row's
// html for one campaign, in sequence order. Called after any action that changes the step
// sequence (add/move/delete) or edits a step's/the opt-in page's own copy, so stored HTML is
// always consistent before the triggering request returns — no stale "next" hrefs ever served.
// Given typical funnel size (a handful of steps), this re-renders everything rather than diffing
// what actually changed — simplest-correct at this scale, matching this codebase's general bias.
export async function rerenderFunnelSequence(
  admin: SupabaseClient,
  campaignId: string,
  userId: string
): Promise<void> {
  const { data: campaign } = await admin
    .from("campaigns")
    .select("product_id, page_copy, embedded_image_data_url")
    .eq("id", campaignId)
    .single();
  if (!campaign) return;

  const { data: product } = await admin
    .from("products")
    .select("product_title, network, vendor_id")
    .eq("id", campaign.product_id)
    .single();
  if (!product) return;

  const { data: connection } = await admin
    .from("network_connections")
    .select("affiliate_id")
    .eq("user_id", userId)
    .eq("network", product.network)
    .maybeSingle();
  const affiliateId = connection?.affiliate_id ?? null;

  const { data: stepsRaw } = await admin
    .from("funnel_steps")
    .select("id, step_type, step_index, page_copy, embedded_image_data_url, cta_action, target_product_id")
    .eq("campaign_id", campaignId)
    .order("step_index", { ascending: true });
  const steps = (stepsRaw ?? []) as FunnelStepRow[];

  // Opt-in page: redirect to step 1 if any steps exist, else today's in-place reveal (unchanged
  // behavior for the ~100% of campaigns with no added funnel steps).
  if (campaign.page_copy && affiliateId) {
    const hoplink = buildHoplink(product.network, affiliateId, product.vendor_id, "page");
    const nextStepUrl = steps.length > 0 ? stepUrl(campaignId, steps[0].step_index) : null;
    const bridgeHtml = renderBridgeHtml(
      product,
      campaign.page_copy as PageCopy,
      hoplink,
      campaign.embedded_image_data_url,
      campaignId,
      nextStepUrl
    );
    await admin.from("campaigns").update({ bridge_html: bridgeHtml }).eq("id", campaignId);
  }

  if (!affiliateId) return; // can't resolve hoplinks without an affiliate id — leave step html as-is

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (!step.page_copy) continue; // not yet edited — nothing to render
    const next = steps[i + 1];
    const nextUrl = next ? stepUrl(campaignId, next.step_index) : null;

    if (step.step_type === "upsell") {
      const targetProductId = step.target_product_id ?? campaign.product_id;
      let targetProduct = product;
      let targetAffiliateId = affiliateId;
      if (targetProductId !== campaign.product_id) {
        const { data: tp } = await admin
          .from("products")
          .select("product_title, network, vendor_id")
          .eq("id", targetProductId)
          .eq("user_id", userId)
          .maybeSingle();
        if (tp) {
          targetProduct = tp;
          if (tp.network !== product.network) {
            const { data: tc } = await admin
              .from("network_connections")
              .select("affiliate_id")
              .eq("user_id", userId)
              .eq("network", tp.network)
              .maybeSingle();
            targetAffiliateId = tc?.affiliate_id ?? null;
          }
        }
      }
      const acceptHref = targetAffiliateId
        ? buildHoplink(targetProduct.network, targetAffiliateId, targetProduct.vendor_id, `step-${step.step_index}-upsell`)
        : "#";
      const declineHref =
        nextUrl ?? buildHoplink(product.network, affiliateId, product.vendor_id, `step-${step.step_index}-decline`);
      const html = renderFunnelStepHtml(
        targetProduct,
        step.page_copy as PageCopy,
        "upsell",
        acceptHref,
        step.embedded_image_data_url,
        declineHref
      );
      await admin.from("funnel_steps").update({ html }).eq("id", step.id);
    } else {
      const primaryHref =
        step.cta_action === "next_step" && nextUrl
          ? nextUrl
          : buildHoplink(product.network, affiliateId, product.vendor_id, `step-${step.step_index}`);
      const html = renderFunnelStepHtml(
        product,
        step.page_copy as PageCopy,
        step.step_type,
        primaryHref,
        step.embedded_image_data_url
      );
      await admin.from("funnel_steps").update({ html }).eq("id", step.id);
    }
  }
}
