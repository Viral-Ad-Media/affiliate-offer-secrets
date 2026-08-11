import { NextResponse } from "next/server";
import { queueChargedJob } from "@/lib/credits";
import { createClient } from "@/lib/supabase/server";
import { currentWorkspaceId, workspaceRequiredResponse } from "@/lib/workspace";

export const dynamic = "force-dynamic";

// Queues a launch_ad job — no credit touch here (deduct-at-activate, not deduct-at-create, so a
// client can build and compare a few paused drafts for free). Ownership checks here are a UX
// nicety for a fast error; queue_job and the worker's "verify" stage both re-check the payload's
// referenced rows against the explicit workspace at their respective trust boundaries.
export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const ws = await currentWorkspaceId();
  if (!ws) return workspaceRequiredResponse();

  const body = await req.json();
  const campaignId = body.campaign_id as string | undefined;
  const adAccountId = body.ad_account_id as string | undefined;
  const pageId = body.page_id as string | undefined;
  const angleIndex = Number(body.angle_index);
  const creativeKind = body.creative_kind as string | undefined;
  const headline = (body.headline as string | undefined)?.trim();
  const primaryText = (body.primary_text as string | undefined)?.trim();
  const country = ((body.country as string | undefined) ?? "US").trim().toUpperCase();
  const budgetCredits = Number(body.budget_credits);

  if (
    !campaignId ||
    !adAccountId ||
    !pageId ||
    !Number.isInteger(angleIndex) ||
    angleIndex < 0 ||
    (creativeKind !== "image" && creativeKind !== "video") ||
    !headline ||
    !primaryText ||
    !Number.isFinite(budgetCredits) ||
    budgetCredits <= 0
  ) {
    return NextResponse.json({ error: "Missing or invalid launch fields" }, { status: 400 });
  }

  const [{ data: ownsCampaign }, { data: ownsPage }, { data: ownsAdAccount }] = await Promise.all([
    supabase.rpc("assert_owns_campaign", { p_campaign_id: campaignId }),
    supabase.rpc("assert_owns_meta_page", { p_page_id: pageId }),
    supabase.rpc("assert_owns_meta_ad_account", { p_ad_account_id: adAccountId }),
  ]);
  if (!ownsCampaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  if (!ownsPage) return NextResponse.json({ error: "Page not found" }, { status: 404 });
  if (!ownsAdAccount) return NextResponse.json({ error: "Ad account not found" }, { status: 404 });

  // Don't let a real paid ad point at a page nobody can see yet — publishing (see
  // app/api/campaigns/[id]/publish/route.ts) is what makes the bridge page publicly reachable.
  const { data: campaign } = await supabase
    .from("campaigns")
    .select("bridge_published, fb_ad_angles")
    .eq("id", campaignId)
    .eq("workspace_id", ws)
    .single();
  if (!campaign?.bridge_published) {
    return NextResponse.json(
      { error: "Publish your bridge page before launching an ad" },
      { status: 400 }
    );
  }
  const angles = (campaign.fb_ad_angles as unknown[] | null) ?? [];
  if (!angles[angleIndex]) {
    return NextResponse.json(
      { error: "Regenerate the campaign kit to unlock structured ad angles first" },
      { status: 400 }
    );
  }

  // Fast, clear 400 here — the worker's own stageVerify re-checks this for real (route is a UX
  // nicety, the worker is the actual boundary, same split as every other job type in this file).
  const { data: creative } = await supabase
    .from("campaign_creatives")
    .select("status")
    .eq("campaign_id", campaignId)
    .eq("workspace_id", ws)
    .eq("source", "fb_ad_angle")
    .eq("item_index", angleIndex)
    .eq("kind", creativeKind)
    .maybeSingle();
  if (!creative || creative.status !== "ready") {
    return NextResponse.json(
      { error: `Generate a ${creativeKind} for this angle before launching it as an ad` },
      { status: 400 }
    );
  }

  // launch_ad is intentionally free at queue time, but it still goes through queue_job so direct
  // jobs INSERT remains closed and every referenced resource is revalidated against this workspace.
  const queued = await queueChargedJob(supabase, {
    workspace_id: ws,
    type: "launch_ad",
    payload: {
      campaign_id: campaignId,
      ad_account_id: adAccountId,
      page_id: pageId,
      angle_index: angleIndex,
      creative_kind: creativeKind,
      // Always "bridge" — the presell page variant was merged into it (see
      // lib/engine/renderPages.ts); ad_launches.destination stays a NOT NULL column with the
      // legacy 'presell' check-constraint option (no live rows use it, harmless to leave).
      destination: "bridge",
      headline,
      primary_text: primaryText,
      country,
      budget_credits: Math.round(budgetCredits),
    },
  });
  if (!queued.ok) return NextResponse.json(queued.body, { status: queued.status });

  return NextResponse.json({
    ok: true,
    job_id: queued.jobId,
    ...(queued.deduped ? { deduped: true } : {}),
  });
}
