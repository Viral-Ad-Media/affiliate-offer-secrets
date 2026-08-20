import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isValidEmail, clampName } from "@/lib/validate";
import { assessEmail } from "@/lib/email/deliverability";
import { readStickyVariantId } from "@/lib/bridgeVariants";
import { normalizePageCopy, type PageBlockTree } from "@/lib/engine/renderPages";
import { extractLeadFormFields } from "@/lib/engine/validatePageBlockTree";
import { SMS_PHONE_FIELD_KEY, SMS_CONSENT_FIELD_KEY, isAffirmativeConsent } from "@/lib/sms";
import { toE164 } from "@/lib/twilio/client";

export const dynamic = "force-dynamic";

// Cheap count-query caps, same idiom as generate-video's MAX_VIDEO_GENERATIONS_PER_DAY guard —
// a valid, status='ready' campaign UUID is already this app's entire access-control model for
// every public route, so per-campaign scoping is consistent defense-in-depth with that model.
const BURST_WINDOW_MS = 10 * 60 * 1000;
const MAX_LEADS_PER_CAMPAIGN_BURST = 20;
const MAX_LEADS_PER_CAMPAIGN_PER_DAY = 300;

// Per-IP caps ACROSS all campaigns — the per-campaign caps miss one source spraying many funnels.
// Counts the same successful-insert rows (contacts already stores ip_address), so no new table or
// state: just two more indexed COUNT queries. Deliberately GENEROUS — a capped submission is a
// SILENT DROP and a shared/NAT/mobile-carrier IP can carry several real visitors, so these exist to
// stop a flood, not to police normal traffic. A CAPTCHA remains the documented next step if a
// determined bot rotates IPs; this raises the cost of the common single-source case with no new deps.
const MAX_LEADS_PER_IP_BURST = 15; // per BURST_WINDOW_MS
const MAX_LEADS_PER_IP_PER_DAY = 60; // per 24h

// Phase O.5: caps for a lead-capture form's user-added fields — mirrors validatePageBlockTree.ts's
// own MAX_FORM_CHILDREN=10 (a form can never legitimately have more than 10 extra fields to begin
// with) and MAX_TEXT_MEDIUM-adjacent 500 char cap for a single submitted value.
const MAX_EXTRA_FIELDS = 10;
const MAX_EXTRA_FIELD_VALUE_CHARS = 500;

// Filters a submitted extra_fields object down to only the keys that are CURRENTLY real fields on
// this exact form (per extractLeadFormFields(tree)) — a key that isn't recognized is silently
// dropped, never a 400: this route's whole philosophy is "never block a real conversion over one
// bad datum" (see the burst/daily caps above, which silently no-op rather than error). A field
// whose fieldType is 'email' gets sub-validated with the same isValidEmail() the primary email
// field uses; an invalid value there is dropped too, not rejected outright.
function filterExtraFields(raw: unknown, tree: PageBlockTree): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const legitFields = extractLeadFormFields(tree);
  if (legitFields.length === 0) return {};
  const fieldTypeByKey = new Map(legitFields.map((f) => [f.fieldKey, f.fieldType]));
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (Object.keys(out).length >= MAX_EXTRA_FIELDS) break;
    const fieldType = fieldTypeByKey.get(key);
    if (!fieldType) continue; // not a real, currently-live field on this form — drop silently
    if (typeof value !== "string") continue;
    const clamped = value.slice(0, MAX_EXTRA_FIELD_VALUE_CHARS).trim();
    if (!clamped) continue;
    if (fieldType === "email" && !isValidEmail(clamped)) continue;
    out[key] = clamped;
  }
  return out;
}

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
    .select("id, user_id, page_copy")
    .eq("id", campaignId)
    .eq("status", "ready")
    .maybeSingle();
  if (!campaign) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const ipAddress = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || null;
  const userAgent = req.headers.get("user-agent");

  const burstSince = new Date(Date.now() - BURST_WINDOW_MS).toISOString();
  const daySince = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const countContacts = (build: (q: any) => any) =>
    build(admin.from("contacts").select("id", { count: "exact", head: true }));

  const [{ count: burstCount }, { count: dailyCount }, ipBurst, ipDaily] = await Promise.all([
    countContacts((q) => q.eq("campaign_id", campaignId).gte("created_at", burstSince)),
    countContacts((q) => q.eq("campaign_id", campaignId).gte("created_at", daySince)),
    // Per-IP counts, skipped entirely when the IP is unknown — a null ip_address filter would match
    // every historical null row and drop legitimate submissions from clients behind a stripped header.
    ipAddress
      ? countContacts((q) => q.eq("ip_address", ipAddress).gte("created_at", burstSince))
      : Promise.resolve({ count: 0 }),
    ipAddress
      ? countContacts((q) => q.eq("ip_address", ipAddress).gte("created_at", daySince))
      : Promise.resolve({ count: 0 }),
  ]);

  // Silently drop over-cap submissions — still 200, no row written. The bridge page's client JS
  // always advances to step 2 regardless of this response (see renderBridgeHtml's submit handler),
  // so a capped submission has zero user-facing effect on a real visitor; it only blocks what's
  // very likely spam, without needing a visibly different response to do so.
  if (
    (burstCount ?? 0) >= MAX_LEADS_PER_CAMPAIGN_BURST ||
    (dailyCount ?? 0) >= MAX_LEADS_PER_CAMPAIGN_PER_DAY ||
    (ipBurst.count ?? 0) >= MAX_LEADS_PER_IP_BURST ||
    (ipDaily.count ?? 0) >= MAX_LEADS_PER_IP_PER_DAY
  ) {
    return NextResponse.json({ ok: true });
  }

  // No client-supplied variant id is ever accepted — the same sticky cookie the page-serving
  // route (lib/publicPage.ts) set is read independently here (the browser sends it automatically
  // on this same-origin fetch, for both the default /p/ URL and a custom domain — /api/public/
  // leads is already exempted from middleware.ts's host-mismatch rewrite for exactly this
  // reason). Re-validated against this campaign before trusting it, same ownership-reverify
  // discipline as everywhere else in this codebase — a forged/foreign cookie value just falls
  // back to null, identical to a non-split-tested campaign's leads today.
  let bridgeVariantId: string | null = null;
  let variantPageCopy: unknown = null;
  const stickyId = readStickyVariantId(req, campaignId);
  if (stickyId) {
    const { data: variant } = await admin
      .from("bridge_variants")
      .select("id, page_copy")
      .eq("id", stickyId)
      .eq("campaign_id", campaignId)
      .maybeSingle();
    bridgeVariantId = variant?.id ?? null;
    variantPageCopy = variant?.page_copy ?? null;
  }

  // A real (non-control) variant's own page_copy is the CURRENT form this visitor actually saw
  // and submitted (servePublicCampaignPage serves variant.bridge_html, not the campaign's, once a
  // variant is assigned) — control rows always have page_copy = null by construction (see the
  // bridge_variants_control_no_content check constraint), so falling back to the campaign's own
  // tree there is correct, not a bug. Re-derived fresh on every submission (never cached) so a
  // field the tenant just removed from the editor is never trusted, even if it was live moments
  // ago — see extractLeadFormFields()'s own doc comment for the same principle.
  const tree = normalizePageCopy(variantPageCopy ?? campaign.page_copy, null);
  const extraFields = filterExtraFields(body.extra_fields, tree);

  // The two reserved keys that make a contact textable. Both halves required, and consent is only
  // recorded from an explicitly TICKED box carrying the reserved key — a phone field alone records
  // a number and nothing else, which is the whole point of keeping them separate (see 0097).
  //
  // The phone is promoted OUT of extra_fields so it has exactly one home; the consent value is
  // deliberately LEFT in extra_fields as well, because "they ticked a box reading <this label> at
  // <this time> from <this IP>" is the evidence of consent, and sms_consent_at alone doesn't carry it.
  const rawPhone = extraFields[SMS_PHONE_FIELD_KEY];
  const phone = typeof rawPhone === "string" ? toE164(rawPhone) : null;
  if (SMS_PHONE_FIELD_KEY in extraFields) delete extraFields[SMS_PHONE_FIELD_KEY];

  // last_name is promoted the same way (0112): the "Last name" form preset always wrote this
  // fieldKey, and a person's name is not an "extra". Full name = first + last at display time.
  const lastName = clampName(extraFields["last_name"]);
  if ("last_name" in extraFields) delete extraFields["last_name"];
  const smsConsentAt = isAffirmativeConsent(extraFields[SMS_CONSENT_FIELD_KEY])
    ? new Date().toISOString()
    : null;

  // Deliverability assessment (0120) — synchronous, no MX lookup (this is the anonymous hot path).
  // A disposable/role address is still CAPTURED, just parked in the moderation queue for review
  // rather than flowing into a send. Never rejects — a false positive would drop a real conversion.
  const assessment = assessEmail(email);

  await admin
    .from("contacts")
    .upsert(
      {
        user_id: campaign.user_id,
        campaign_id: campaignId,
        bridge_variant_id: bridgeVariantId,
        first_name: firstName || null,
        last_name: lastName || null,
        email,
        phone,
        // NULL unless the box was ticked. Never inferred from the presence of a number.
        sms_consent_at: smsConsentAt,
        extra_fields: extraFields,
        ip_address: ipAddress,
        user_agent: userAgent,
        review_status: assessment.reviewStatus,
        review_reason: assessment.reason,
      },
      { onConflict: "campaign_id,email", ignoreDuplicates: true }
    );

  return NextResponse.json({ ok: true });
}
