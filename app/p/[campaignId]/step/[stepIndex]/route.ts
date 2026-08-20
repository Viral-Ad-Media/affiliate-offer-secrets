import { createAdminClient } from "@/lib/supabase/admin";
import { publicNotFound } from "@/lib/notFoundPage";
import { publicWorkspaceScope } from "@/lib/publicPage";
import { recordFunnelPageView } from "@/lib/funnelPageStats";
import { PUBLIC_CONTENT_CSP } from "@/lib/csp";

export const dynamic = "force-dynamic";

// Mirrors app/p/[campaignId]/bridge/route.ts (lib/publicPage.ts's servePublicCampaignPage) exactly
// — same campaign UUID + status='ready' + bridge_published=true gate (one funnel-wide publish
// toggle for the opt-in page and every step), same generic 404 for not-found/not-published (no
// status oracle). Reached only via the internal opt-in -> step 1 -> step 2 ... redirect chain
// (lib/funnelSteps.ts resolves each step's own CTA href at render time) — never independently
// domain-mapped or split-tested in this phase (see CLAUDE.md).
export async function GET(
  req: Request,
  { params }: { params: { campaignId: string; stepIndex: string } }
) {
  const stepIndex = Number(params.stepIndex);
  if (!Number.isInteger(stepIndex) || stepIndex < 1) {
    return publicNotFound(req.headers.get("host"));
  }

  const admin = createAdminClient();
  const { data: campaign } = await admin
    .from("campaigns")
    .select("id, workspace_id")
    .eq("id", params.campaignId)
    // Same reasoning as lib/publicPage.ts: `status` describes the last BUILD, not the page. A
    // failed rebuild must not break the middle of a funnel a visitor is already walking through —
    // that would be worse here than on the opt-in page, since the lead has already been captured.
    // bridge_published stays the tenant-controlled switch.
    .eq("bridge_published", true)
    .maybeSingle();
  if (!campaign) {
    return publicNotFound(req.headers.get("host"));
  }

  // Same host scoping as the opt-in page (lib/publicPage.ts): a workspace subdomain only ever
  // serves its own workspace's funnel steps, same generic 404 on a mismatch.
  const scope = await publicWorkspaceScope(admin, req.headers.get("host"));
  if (scope.restricted && (!scope.workspaceId || scope.workspaceId !== campaign.workspace_id)) {
    return publicNotFound(req.headers.get("host"));
  }

  const { data: step } = await admin
    .from("funnel_steps")
    .select("id, html")
    .eq("campaign_id", params.campaignId)
    .eq("step_index", stepIndex)
    .maybeSingle();

  if (!step?.html) {
    return publicNotFound(req.headers.get("host"));
  }

  // Funnel-map views counter (0110), keyed by the step's ID — never its index, which
  // move_funnel_step swaps between rows, so an index-keyed stat would start describing a
  // different page after any reorder. Once per visitor per page, same dedupe cookie as the
  // opt-in page's counter in lib/publicPage.ts.
  const statsCookie = await recordFunnelPageView(admin, req, params.campaignId, step.id as string);

  const headers = new Headers({
    "Content-Type": "text/html; charset=utf-8",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Robots-Tag": "noindex",
    "Content-Security-Policy": PUBLIC_CONTENT_CSP,
  });
  if (statsCookie) headers.append("Set-Cookie", statsCookie);

  return new Response(step.html, { status: 200, headers });
}
