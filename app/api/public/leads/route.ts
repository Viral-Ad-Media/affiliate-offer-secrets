import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isValidEmail, clampName } from "@/lib/validate";
import { readStickyVariantId } from "@/lib/bridgeVariants";

export const dynamic = "force-dynamic";

// Two independent, cheap count-query caps, same idiom as generate-video's MAX_VIDEO_GENERATIONS_
// PER_DAY guard — a valid, status='ready' campaign UUID is already this app's entire access-
// control model for every public route, so per-campaign scoping is consistent defense-in-depth
// with that existing model, not a weaker substitute for something broader. Deliberately NOT doing
// IP-based limiting or a CAPTCHA here — no rate-limiting infrastructure exists anywhere in this
// codebase to build on, and that's a stated, documented v1 gap (see CLAUDE.md), not an oversight.
const BURST_WINDOW_MS = 10 * 60 * 1000;
const MAX_LEADS_PER_CAMPAIGN_BURST = 20;
const MAX_LEADS_PER_CAMPAIGN_PER_DAY = 300;

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const campaignId = typeof body.campaign_id === "string" ? body.campaign_id : "";
  // Lowercased before every insert/conflict-check — this, not a functional index, is how
  // case-insensitive de-dupe is achieved (see the unique index's comment in the migration).
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const firstName = clampName(body.first_name);

  // These are the real checks — the bridge page's client-side type="email"/required attributes
  // are trivially bypassed by anyone posting to this endpoint directly.
  if (!campaignId || !isValidEmail(email)) {
    return NextResponse.json({ error: "invalid submission" }, { status: 400 });
  }

  const admin = createAdminClient();

  // Same UUID + status='ready' scoping as servePublicCampaignPage — the campaign's unguessability
  // is the access control. user_id comes ONLY from the campaign row; there is no client-suppliable
  // tenant field anywhere in this request shape, and there must never be one added later. Generic
  // 404 here (no distinguishing message) matters: it's the same enumeration surface every existing
  // public GET route already guards (guessing valid campaign UUIDs) — a distinguishable response
  // here would reopen that oracle via a new verb.
  const { data: campaign } = await admin
    .from("campaigns")
    .select("id, user_id")
    .eq("id", campaignId)
    .eq("status", "ready")
    .maybeSingle();
  if (!campaign) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const [{ count: burstCount }, { count: dailyCount }] = await Promise.all([
    admin
      .from("contacts")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", campaignId)
      .gte("created_at", new Date(Date.now() - BURST_WINDOW_MS).toISOString()),
    admin
      .from("contacts")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", campaignId)
      .gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()),
  ]);

  // Silently drop over-cap submissions — still 200, no row written. The bridge page's client JS
  // always advances to step 2 regardless of this response (see renderBridgeHtml's submit handler),
  // so a capped submission has zero user-facing effect on a real visitor; it only blocks what's
  // very likely spam, without needing a visibly different response to do so.
  if ((burstCount ?? 0) >= MAX_LEADS_PER_CAMPAIGN_BURST || (dailyCount ?? 0) >= MAX_LEADS_PER_CAMPAIGN_PER_DAY) {
    return NextResponse.json({ ok: true });
  }

  const ipAddress = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || null;
  const userAgent = req.headers.get("user-agent");

  // No client-supplied variant id is ever accepted — the same sticky cookie the page-serving
  // route (lib/publicPage.ts) set is read independently here (the browser sends it automatically
  // on this same-origin fetch, for both the default /p/ URL and a custom domain — /api/public/
  // leads is already exempted from middleware.ts's host-mismatch rewrite for exactly this
  // reason). Re-validated against this campaign before trusting it, same ownership-reverify
  // discipline as everywhere else in this codebase — a forged/foreign cookie value just falls
  // back to null, identical to a non-split-tested campaign's leads today.
  let bridgeVariantId: string | null = null;
  const stickyId = readStickyVariantId(req, campaignId);
  if (stickyId) {
    const { data: variant } = await admin
      .from("bridge_variants")
      .select("id")
      .eq("id", stickyId)
      .eq("campaign_id", campaignId)
      .maybeSingle();
    bridgeVariantId = variant?.id ?? null;
  }

  await admin
    .from("contacts")
    .upsert(
      {
        user_id: campaign.user_id,
        campaign_id: campaignId,
        bridge_variant_id: bridgeVariantId,
        first_name: firstName || null,
        email,
        ip_address: ipAddress,
        user_agent: userAgent,
      },
      { onConflict: "campaign_id,email", ignoreDuplicates: true }
    );

  return NextResponse.json({ ok: true });
}
