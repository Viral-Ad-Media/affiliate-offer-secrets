import type { SupabaseClient } from "@supabase/supabase-js";
import { slugify } from "@/lib/blog";
import {
  renderBridgeHtml,
  renderFunnelStepHtml,
  buildHoplink,
  type FunnelStepType,
  type TrackingSettings,
} from "@/lib/engine/renderPages";

type CtaAction = "next_step" | "hoplink" | "redirect_url";

type FunnelStepRow = {
  id: string;
  step_type: FunnelStepType;
  step_index: number;
  // Opaque — could be the legacy flat shape or a version-2 PageBlockTree depending on when this
  // row was last saved; renderFunnelStepHtml normalizes either via normalizePageCopy() itself.
  page_copy: unknown;
  embedded_image_data_url: string | null;
  cta_action: CtaAction;
  redirect_url: string | null;
  target_product_id: string | null;
  decline_action: CtaAction;
  decline_redirect_url: string | null;
  // Per-step SEO overrides (0032) — passed straight to renderFunnelStepHtml's `seo` param.
  seo_title: string | null;
  seo_description: string | null;
};

// Path-relative on purpose (Phase 3): the baked "next step" href follows whatever host the
// visitor is on — a visitor who entered on a workspace subdomain continues the funnel there, one
// who entered via an ad on the canonical host continues there. Deleting the host from stored HTML
// is strictly better than picking either absolute host, and it means a workspace rename never
// breaks a step chain. Real Meta ad link_urls stay absolute on the canonical host for the same
// reason, in lib/engine/adlaunch.ts — an ad already spending must never depend on a mutable slug.
function stepUrl(campaignId: string, stepIndex: number): string {
  return `/p/${campaignId}/step/${stepIndex}`;
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
  workspaceId: string
): Promise<void> {
  const { data: campaign } = await admin
    .from("campaigns")
    .select("product_id, name, cta_url, page_copy, embedded_image_data_url, tracking, seo_title, seo_description")
    .eq("id", campaignId)
    .single();
  if (!campaign) return;
  const tracking = (campaign.tracking ?? null) as TrackingSettings | null;

  // A hand-built funnel has no product (0068). It still renders — it just has no hoplink to bake,
  // so its call to action falls back to campaigns.cta_url, and to "#" until one is set. Returning
  // early here (as this did when the product lookup failed) would have left every standalone
  // funnel with no HTML at all.
  const { data: productRow } = campaign.product_id
    ? await admin
        .from("products")
        .select("product_title, network, vendor_id, hoplink_override")
        .eq("id", campaign.product_id)
        .maybeSingle()
    : { data: null };
  const product = productRow ?? {
    product_title: (campaign.name as string | null) ?? "Funnel",
    network: null as string | null,
    vendor_id: "",
    hoplink_override: null as string | null,
  };

  const { data: connection } = product.network
    ? await admin
        .from("network_connections")
        .select("affiliate_id")
        .eq("workspace_id", workspaceId)
        .eq("network", product.network)
        .maybeSingle()
    : { data: null };
  const affiliateId = connection?.affiliate_id ?? null;

  // The opt-in page's primary destination: the product's hoplink when there is one, otherwise the
  // funnel's own cta_url. One source of truth, never two competing ones.
  const fallbackHref = (campaign.cta_url as string | null) ?? "#";
  const offerHref = (tid: string) =>
    product.network && affiliateId
      ? buildHoplink(product.network as any, affiliateId, product.vendor_id, tid, product.hoplink_override)
      : fallbackHref;

  const { data: stepsRaw } = await admin
    .from("funnel_steps")
    .select(
      "id, step_type, step_index, page_copy, embedded_image_data_url, cta_action, redirect_url, target_product_id, decline_action, decline_redirect_url, seo_title, seo_description"
    )
    .eq("campaign_id", campaignId)
    .order("step_index", { ascending: true });
  const steps = (stepsRaw ?? []) as FunnelStepRow[];

  // Opt-in page: redirect to step 1 if any steps exist, else today's in-place reveal (unchanged
  // behavior for the ~100% of campaigns with no added funnel steps).
  if (campaign.page_copy) {
    const hoplink = offerHref("page");
    const nextStepUrl = steps.length > 0 ? stepUrl(campaignId, steps[0].step_index) : null;
    const bridgeHtml = renderBridgeHtml(
      product,
      campaign.page_copy,
      hoplink,
      campaign.embedded_image_data_url,
      campaignId,
      nextStepUrl,
      tracking,
      campaign
    );
    await admin.from("campaigns").update({ bridge_html: bridgeHtml }).eq("id", campaignId);

    // Split-test variants serve at the same URL as the control, so they need the same
    // nextStepUrl (and tracking) baked in. This closes a pre-existing gap: before this,
    // rerenderFunnelSequence only rewrote campaigns.bridge_html — a non-control variant's page
    // never picked up funnel-step redirects, so visitors assigned to B+ on a multi-step funnel
    // got the in-place reveal instead of step 1.
    const { data: variants } = await admin
      .from("bridge_variants")
      .select("id, page_copy, embedded_image_data_url, is_control")
      .eq("campaign_id", campaignId)
      .eq("is_control", false);
    for (const v of variants ?? []) {
      if (!v.page_copy) continue;
      const variantHtml = renderBridgeHtml(
        product,
        v.page_copy,
        hoplink,
        v.embedded_image_data_url,
        campaignId,
        nextStepUrl,
        tracking,
        campaign
      );
      await admin.from("bridge_variants").update({ bridge_html: variantHtml }).eq("id", v.id);
    }
  }

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (!step.page_copy) continue; // not yet edited — nothing to render
    const next = steps[i + 1];
    const nextUrl = next ? stepUrl(campaignId, next.step_index) : null;

    if (step.step_type === "upsell") {
      let targetProduct = product;

      let acceptHref: string;
      if (step.cta_action === "redirect_url" && step.redirect_url) {
        acceptHref = step.redirect_url;
      } else if (step.cta_action === "next_step" && nextUrl) {
        acceptHref = nextUrl;
      } else {
        // 'hoplink' (explicit or fallback) — resolve the target product/connection, only when
        // actually needed (skipped entirely for the redirect_url/next_step branches above).
        const targetProductId = step.target_product_id ?? campaign.product_id;
        let targetAffiliateId = affiliateId;
        if (targetProductId !== campaign.product_id) {
          const { data: tp } = await admin
            .from("products")
            .select("product_title, network, vendor_id, hoplink_override")
            .eq("id", targetProductId)
            .eq("workspace_id", workspaceId)
            .maybeSingle();
          if (tp) {
            targetProduct = tp;
            if (tp.network !== product.network) {
              const { data: tc } = await admin
                .from("network_connections")
                .select("affiliate_id")
                .eq("workspace_id", workspaceId)
                .eq("network", tp.network)
                .maybeSingle();
              targetAffiliateId = tc?.affiliate_id ?? null;
            }
          }
        }
        acceptHref =
          targetAffiliateId && targetProduct.network
            ? buildHoplink(
                targetProduct.network as any,
                targetAffiliateId,
                targetProduct.vendor_id,
                `step-${step.step_index}-upsell`,
                targetProduct.hoplink_override
              )
            : fallbackHref;
      }

      let declineHref: string;
      if (step.decline_action === "redirect_url" && step.decline_redirect_url) {
        declineHref = step.decline_redirect_url;
      } else if (step.decline_action === "hoplink") {
        declineHref = offerHref(`step-${step.step_index}-decline`);
      } else {
        declineHref = nextUrl ?? offerHref(`step-${step.step_index}-decline`);
      }

      const html = renderFunnelStepHtml(
        targetProduct,
        step.page_copy,
        "upsell",
        acceptHref,
        step.embedded_image_data_url,
        declineHref,
        tracking,
        step
      );
      await admin.from("funnel_steps").update({ html }).eq("id", step.id);
    } else {
      let primaryHref: string;
      if (step.cta_action === "redirect_url" && step.redirect_url) {
        primaryHref = step.redirect_url;
      } else if (step.cta_action === "next_step" && nextUrl) {
        primaryHref = nextUrl;
      } else {
        primaryHref = offerHref(`step-${step.step_index}`);
      }
      const html = renderFunnelStepHtml(
        product,
        step.page_copy,
        step.step_type,
        primaryHref,
        step.embedded_image_data_url,
        null,
        tracking,
        step
      );
      await admin.from("funnel_steps").update({ html }).eq("id", step.id);
    }
  }
}

/**
 * A short, brandable path segment for a funnel on a tenant's own domain.
 *
 * Deliberately NOT just slugify(title). Marketplace product titles are written to sell inside a
 * marketplace listing, not to be a URL — "TedsWoodworking - Highest Converting Woodworking Site On
 * The Internet!" slugifies to 62 characters of keyword stuffing that nobody would paste into an ad.
 * The part before the first separator is almost always the product's actual name, so that is what
 * a branded link should be. Capped to a handful of words for the titles that have no separator at
 * all, and never empty — the caller de-duplicates, so a collapse to "funnel" is still usable.
 */
export function funnelPathSlug(title: string): string {
  const head = title.split(/\s+[-–—|:]\s+|[-–—|:]\s+/)[0] ?? title;
  const words = slugify(head).split("-").filter(Boolean).slice(0, 5);
  return words.join("-") || slugify(title).slice(0, 40).replace(/-+$/, "") || "funnel";
}
