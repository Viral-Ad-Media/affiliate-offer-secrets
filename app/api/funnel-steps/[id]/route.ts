import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { rerenderFunnelSequence } from "@/lib/funnelSteps";
import { isValidImageDataUrl } from "@/lib/images/validate";

export const dynamic = "force-dynamic";

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

const MAX_REDIRECT_URL = 2000;

// Admin/tenant-supplied, not public input — but this still becomes a real <a href> on the
// tenant's own funnel step, so a cheap scheme allowlist avoids an accidental self-XSS via a
// javascript:/data: URI (copy-pasted from somewhere untrusted, browser autofill, etc.).
function isValidRedirectUrl(v: unknown): v is string {
  return typeof v === "string" && v.length > 0 && v.length <= MAX_REDIRECT_URL && /^https?:\/\//i.test(v);
}

type CtaAction = "next_step" | "hoplink" | "redirect_url";

function parseAction(v: unknown, fallback: CtaAction): CtaAction {
  return v === "next_step" || v === "hoplink" || v === "redirect_url" ? v : fallback;
}

// Same validate/render/write shape as app/api/campaigns/[id]/page-copy/route.ts, scoped to a
// funnel_steps row. The actual re-render happens in rerenderFunnelSequence (this route just
// persists the edited copy/settings, then triggers it) since it needs to resolve this step's
// CTA href against its neighbors, not just its own content.
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

  const stepId = params.id;

  const { data: owns, error: ownErr } = await supabase.rpc("assert_owns_funnel_step", {
    p_step_id: stepId,
  });
  if (ownErr || !owns) {
    return NextResponse.json({ error: "step not found" }, { status: 404 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const benefitsIn = Array.isArray(body.benefits) ? body.benefits : [];
  const faqIn = Array.isArray(body.faq) ? body.faq : [];

  const copy = {
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

  const ctaAction = parseAction(body.cta_action, "hoplink");
  let redirectUrl: string | null = null;
  if (ctaAction === "redirect_url") {
    if (!isValidRedirectUrl(body.redirect_url)) {
      return NextResponse.json({ error: "invalid redirect URL" }, { status: 400 });
    }
    redirectUrl = body.redirect_url;
  }

  const declineAction = parseAction(body.decline_action, "next_step");
  let declineRedirectUrl: string | null = null;
  if (declineAction === "redirect_url") {
    if (!isValidRedirectUrl(body.decline_redirect_url)) {
      return NextResponse.json({ error: "invalid decline redirect URL" }, { status: 400 });
    }
    declineRedirectUrl = body.decline_redirect_url;
  }

  const admin = createAdminClient();

  const { data: step, error: stepErr } = await admin
    .from("funnel_steps")
    .select("campaign_id, step_type")
    .eq("id", stepId)
    .single();
  if (stepErr || !step) {
    return NextResponse.json({ error: "step not found" }, { status: 404 });
  }

  let targetProductId: string | null = null;
  if (step.step_type === "upsell" && typeof body.target_product_id === "string" && body.target_product_id) {
    // Cross-sell must point at THIS user's own product — never trust a foreign id.
    const { data: targetProduct } = await admin
      .from("products")
      .select("id")
      .eq("id", body.target_product_id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!targetProduct) {
      return NextResponse.json({ error: "invalid target product" }, { status: 400 });
    }
    targetProductId = targetProduct.id;
  }

  const { error: updateErr } = await admin
    .from("funnel_steps")
    .update({
      page_copy: copy,
      embedded_image_data_url: imageDataUrl,
      cta_action: ctaAction,
      redirect_url: redirectUrl,
      target_product_id: targetProductId,
      decline_action: declineAction,
      decline_redirect_url: declineRedirectUrl,
      updated_at: new Date().toISOString(),
    })
    .eq("id", stepId);
  if (updateErr) {
    return NextResponse.json({ error: "failed to save" }, { status: 500 });
  }

  await rerenderFunnelSequence(admin, step.campaign_id, user.id);

  const { data: rendered } = await admin.from("funnel_steps").select("html").eq("id", stepId).single();

  return NextResponse.json({ ok: true, html: rendered?.html ?? null, page_copy: copy });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const stepId = params.id;

  const admin = createAdminClient();
  const { data: step } = await admin.from("funnel_steps").select("campaign_id").eq("id", stepId).eq("user_id", user.id).maybeSingle();
  if (!step) {
    return NextResponse.json({ error: "step not found" }, { status: 404 });
  }

  const { error: rpcErr } = await supabase.rpc("delete_funnel_step", { p_step_id: stepId });
  if (rpcErr) {
    return NextResponse.json({ error: rpcErr.message }, { status: 400 });
  }

  await rerenderFunnelSequence(admin, step.campaign_id, user.id);

  return NextResponse.json({ ok: true });
}
