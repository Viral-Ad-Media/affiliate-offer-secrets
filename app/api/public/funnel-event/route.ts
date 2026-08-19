import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

// Click counter for the funnel map's per-page stats (0110_funnel_page_stats.sql), fed by the
// code-owned sendBeacon in every funnel page's shell (lib/engine/renderPages.ts). An anonymous,
// unauthenticated write — the /api/public/leads trust model, scaled down to fit what this can
// touch: the only effect a forged request can have is +1 on a counter row that already exists
// per (campaign, page), so there is no storage growth, no PII, and nothing to enumerate.
//
// Always 204, whatever happened. A beacon has no reader (sendBeacon fires during navigation
// away), and a distinct status per failure reason would be a free campaign-state oracle.
//
// Deliberately NO recency rate cap, unlike the leads route: that route counts recent contacts
// rows to cap, and this table stores counters, not dated events — there is nothing to count
// recency against. The bounded write is the mitigation; the metric is informational, never a
// billing or delivery input.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGE_KEY_RE = /^[a-z0-9-]{1,40}$/;

export async function POST(req: Request) {
  const done = new Response(null, { status: 204 });

  // sendBeacon posts text/plain — read the raw body and parse, never req.json() (which would
  // reject on the content type with some runtimes).
  let body: { campaign_id?: unknown; page_key?: unknown } = {};
  try {
    body = JSON.parse(await req.text());
  } catch {
    return done;
  }
  const campaignId = typeof body.campaign_id === "string" ? body.campaign_id : "";
  const pageKey = typeof body.page_key === "string" ? body.page_key : "";
  if (!UUID_RE.test(campaignId) || !PAGE_KEY_RE.test(pageKey)) return done;

  const admin = createAdminClient();
  // Only pages that are actually live can accrue clicks — an unpublished campaign silently
  // drops, so the endpoint can't be used to write stats onto drafts.
  const { data: campaign } = await admin
    .from("campaigns")
    .select("id")
    .eq("id", campaignId)
    .eq("bridge_published", true)
    .maybeSingle();
  if (!campaign) return done;

  try {
    await admin.rpc("increment_funnel_page_stat", {
      p_campaign_id: campaignId,
      p_page_key: pageKey,
      p_metric: "click",
    });
  } catch {
    // stats are secondary — never let a counter hiccup surface to a visitor's beacon
  }
  return done;
}
