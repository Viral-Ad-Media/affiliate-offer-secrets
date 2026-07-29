import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

// Mirrors app/p/[campaignId]/bridge/route.ts (lib/publicPage.ts's servePublicCampaignPage) exactly
// — same campaign UUID + status='ready' + bridge_published=true gate (one funnel-wide publish
// toggle for the opt-in page and every step), same generic 404 for not-found/not-published (no
// status oracle). Reached only via the internal opt-in -> step 1 -> step 2 ... redirect chain
// (lib/funnelSteps.ts resolves each step's own CTA href at render time) — never independently
// domain-mapped or split-tested in this phase (see CLAUDE.md).
export async function GET(
  _req: Request,
  { params }: { params: { campaignId: string; stepIndex: string } }
) {
  const stepIndex = Number(params.stepIndex);
  if (!Number.isInteger(stepIndex) || stepIndex < 1) {
    return new Response("Not found", { status: 404 });
  }

  const admin = createAdminClient();
  const { data: campaign } = await admin
    .from("campaigns")
    .select("id")
    .eq("id", params.campaignId)
    .eq("status", "ready")
    .eq("bridge_published", true)
    .maybeSingle();
  if (!campaign) {
    return new Response("Not found", { status: 404 });
  }

  const { data: step } = await admin
    .from("funnel_steps")
    .select("html")
    .eq("campaign_id", params.campaignId)
    .eq("step_index", stepIndex)
    .maybeSingle();

  if (!step?.html) {
    return new Response("Not found", { status: 404 });
  }

  return new Response(step.html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "X-Robots-Tag": "noindex",
    },
  });
}
