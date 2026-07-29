import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { renderBridgeHtml, buildHoplink, resolveSectionOrder, type PageCopy } from "@/lib/engine/renderPages";
import { isValidImageDataUrl } from "@/lib/images/validate";

export const dynamic = "force-dynamic";

// Identical validate/render/write shape to app/api/campaigns/[id]/page-copy/route.ts, scoped to a
// bridge_variants row instead of a campaigns row — the same PageEditor component PATCHes either
// endpoint (see its new saveEndpoint prop). assert_owns_bridge_variant() already excludes control
// rows (design-review fix #1 in the split-testing plan) — a control id 404s here rather than
// silently writing content into a column nothing ever reads.

const MAX_HEADLINE = 200;
const MAX_MEDIUM = 1000;
const MAX_LONG = 3000;
const MAX_BENEFITS = 10;
const MAX_BENEFIT_LEN = 300;
const MAX_FAQ = 10;
const MAX_CTA = 60;

function clampStr(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  return v.slice(0, max).trim();
}

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

  const benefitsIn = Array.isArray(body.benefits) ? body.benefits : [];
  const faqIn = Array.isArray(body.faq) ? body.faq : [];

  const copy: PageCopy = {
    headline: clampStr(body.headline, MAX_HEADLINE),
    lead: clampStr(body.lead, MAX_MEDIUM),
    mechanism: clampStr(body.mechanism, MAX_LONG),
    benefits: benefitsIn
      .slice(0, MAX_BENEFITS)
      .map((b) => clampStr(b, MAX_BENEFIT_LEN))
      .filter(Boolean),
    proof: clampStr(body.proof, MAX_MEDIUM),
    faq: faqIn
      .slice(0, MAX_FAQ)
      .map((f) => ({
        q: clampStr((f as Record<string, unknown>)?.q, MAX_HEADLINE),
        a: clampStr((f as Record<string, unknown>)?.a, MAX_MEDIUM),
      }))
      .filter((f) => f.q && f.a),
    cta: clampStr(body.cta, MAX_CTA) || "Get started",
    sectionOrder: resolveSectionOrder(Array.isArray(body.section_order) ? body.section_order : null),
  };

  if (!copy.headline || !copy.lead) {
    return NextResponse.json({ error: "headline and lead are required" }, { status: 400 });
  }

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
    .select("product_id")
    .eq("id", variant.campaign_id)
    .single();
  if (campaignErr || !campaign) {
    return NextResponse.json({ error: "campaign not found" }, { status: 404 });
  }

  const { data: product, error: productErr } = await admin
    .from("products")
    .select("product_title, network, vendor_id, hoplink")
    .eq("id", campaign.product_id)
    .single();
  if (productErr || !product) {
    return NextResponse.json({ error: "product not found" }, { status: 404 });
  }

  const { data: connection } = await admin
    .from("network_connections")
    .select("affiliate_id")
    .eq("user_id", user.id)
    .eq("network", product.network)
    .maybeSingle();
  if (!connection?.affiliate_id) {
    return NextResponse.json(
      { error: `Connect your ${product.network} affiliate ID first` },
      { status: 400 }
    );
  }

  const hoplink = buildHoplink(product.network, connection.affiliate_id, product.vendor_id, "page");

  const bridgeHtml = renderBridgeHtml(product, copy, hoplink, imageDataUrl, variant.campaign_id);

  const { error: updateErr } = await admin
    .from("bridge_variants")
    .update({
      page_copy: copy,
      bridge_html: bridgeHtml,
      embedded_image_data_url: imageDataUrl,
      updated_at: new Date().toISOString(),
    })
    .eq("id", variantId);

  if (updateErr) {
    return NextResponse.json({ error: "failed to save" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, bridge_html: bridgeHtml });
}
