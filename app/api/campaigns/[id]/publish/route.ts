import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizePageCopy } from "@/lib/engine/renderPages";
import { funnelPageChecklist, funnelStepChecklist, type ChecklistItem } from "@/lib/pageChecklist";
import { STEP_TYPE_LABELS } from "@/lib/funnelTypes";
import type { FunnelStepType } from "@/lib/shared";

export const dynamic = "force-dynamic";

/** Labels of the REQUIRED items still outstanding. Recommended ones never block publishing. */
function missingRequired(items: ChecklistItem[]): string[] {
  return items.filter((i) => i.severity === "required" && !i.done).map((i) => i.label);
}

// Toggles whether a campaign's bridge page is publicly reachable (servePublicCampaignPage /
// lib/publicPage.ts now requires bridge_published = true, not just status = 'ready'). Ownership
// check via the RLS-respecting user-scoped client first, same pattern as page-copy/route.ts; the
// actual write goes through the admin client since campaigns has no client-write RLS.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const campaignId = params.id;

  const { data: owns, error: ownErr } = await supabase.rpc("assert_owns_campaign", {
    p_campaign_id: campaignId,
  });
  if (ownErr || !owns) {
    return NextResponse.json({ error: "campaign not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const published = body.published === true;

  const admin = createAdminClient();

  // Unpublishing is never gated. Taking a live page DOWN must always work — the one thing worse
  // than an incomplete published page is an incomplete published page you can't retract.
  if (published) {
    const { data: campaign } = await admin
      .from("campaigns")
      .select("status, bridge_html, page_copy, funnel_type")
      .eq("id", campaignId)
      .single();
    if (!campaign || campaign.status !== "ready" || !campaign.bridge_html) {
      return NextResponse.json(
        { error: "Bridge page isn't ready to publish yet — the campaign kit must finish building first" },
        { status: 400 }
      );
    }

    // Publishing is the gate; saving a draft never is. This is the real boundary — PublishBridge
    // disables its own button too, but that's UX: this route is directly callable.
    const missing = missingRequired(
      funnelPageChecklist(campaign.funnel_type, normalizePageCopy(campaign.page_copy, null))
    );

    // One publish switch covers the opt-in page AND every step, so a step missing its essentials
    // would go live under the same toggle — it has to be checked here too or the gate is a
    // half-measure that only guards the first page of the funnel.
    const { data: steps } = await admin
      .from("funnel_steps")
      .select("step_type, step_index, page_copy")
      .eq("campaign_id", campaignId)
      .order("step_index");

    for (const s of steps ?? []) {
      const stepMissing = missingRequired(
        funnelStepChecklist(s.step_type, normalizePageCopy(s.page_copy, null, { stepType: s.step_type }))
      );
      missing.push(...stepMissing.map((m) => `Step ${s.step_index} (${STEP_TYPE_LABELS[s.step_type as FunnelStepType]}): ${m}`));
    }

    if (missing.length > 0) {
      return NextResponse.json(
        {
          error: "This funnel is missing elements its type needs before it can go live.",
          missing,
        },
        { status: 400 }
      );
    }
  }

  const { error: updateErr } = await admin
    .from("campaigns")
    .update({ bridge_published: published })
    .eq("id", campaignId);
  if (updateErr) {
    return NextResponse.json({ error: "failed to save" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, published });
}
