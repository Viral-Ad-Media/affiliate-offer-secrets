import { NextResponse } from "next/server";
import { queueChargedJob } from "@/lib/credits";
import { currentWorkspaceId, workspaceRequiredResponse } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { FbAdAngle, SocialPost } from "@/lib/shared";

export const dynamic = "force-dynamic";

const KNOWN_SOURCES = ["fb_ad_angle", "social_post"] as const;
const KNOWN_KINDS = ["image", "video"] as const;

// Nominal runaway-loop backstops, not real budget controls yet — the user is testing solo and
// explicitly doesn't want to hit a ceiling while trying this out. Revisit before opening this
// beyond solo testing. Video is pooled with the legacy single-campaign generate_video route;
// image is pooled with the legacy single-campaign generate_ad_image route — a client can't dodge
// either cap by picking the other route for the same kind of generation.
const MAX_VIDEO_GENERATIONS_PER_DAY = 100;
const MAX_CREATIVE_IMAGE_GENERATIONS_PER_DAY = 100;

export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const ws = await currentWorkspaceId();
  if (!ws) return workspaceRequiredResponse();

  const body = await req.json().catch(() => ({}));
  const campaignId = body.campaign_id as string | undefined;
  const source = body.source as string | undefined;
  const kind = body.kind as string | undefined;
  const itemIndex = Number(body.item_index);

  if (
    !campaignId ||
    !KNOWN_SOURCES.includes(source as any) ||
    !KNOWN_KINDS.includes(kind as any) ||
    !Number.isInteger(itemIndex) ||
    itemIndex < 0
  ) {
    return NextResponse.json({ error: "Missing or invalid request fields" }, { status: 400 });
  }

  // RLS (select-only) is the implicit ownership check here — a row for another tenant's campaign
  // simply won't be visible, same idiom app/api/meta/ads/activate/route.ts already relies on.
  const { data: campaign } = await supabase
    .from("campaigns")
    .select("fb_ad_angles, social_posts")
    .eq("id", campaignId)
    .maybeSingle();
  if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });

  const items = (source === "fb_ad_angle" ? campaign.fb_ad_angles : campaign.social_posts) as
    | FbAdAngle[]
    | SocialPost[]
    | null;
  if (!items) {
    return NextResponse.json(
      { error: "Regenerate the campaign kit to unlock structured angles/posts first" },
      { status: 400 }
    );
  }
  if (itemIndex >= items.length) {
    return NextResponse.json({ error: `No ${source} at index ${itemIndex}` }, { status: 400 });
  }

  const admin = createAdminClient();

  const jobType = kind === "video" ? "generate_creative_video" : "generate_creative_image";
  const legacyJobType = kind === "video" ? "generate_video" : "generate_ad_image";
  const dailyCap = kind === "video" ? MAX_VIDEO_GENERATIONS_PER_DAY : MAX_CREATIVE_IMAGE_GENERATIONS_PER_DAY;

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count } = await admin
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", ws)
    .in("type", [jobType, legacyJobType])
    .gte("created_at", since);
  if ((count ?? 0) >= dailyCap) {
    return NextResponse.json(
      { error: `Daily ${kind} generation limit reached (${dailyCap}/day)` },
      { status: 429 }
    );
  }

  const { data: creativeId, error: claimErr } = await supabase.rpc("claim_campaign_creative", {
    p_campaign_id: campaignId,
    p_source: source,
    p_item_index: itemIndex,
    p_kind: kind,
  });
  if (claimErr) return NextResponse.json({ error: claimErr.message }, { status: 400 });
  if (!creativeId) {
    return NextResponse.json({ error: "This creative is already generating" }, { status: 409 });
  }

  const queued = await queueChargedJob(
    supabase,
    { workspace_id: ws, type: jobType, payload: { campaign_creative_id: creativeId } },
    {
      // Roll back the claim if the insert failed OR the charge was declined, so the row isn't
      // stuck "generating" forever — authenticated has no UPDATE grant on campaign_creatives, so
      // this needs the admin client (mirrors generate-video/route.ts's rollback pattern).
      onRollback: async () => {
        await admin.from("campaign_creatives").update({ status: "none" }).eq("id", creativeId);
      },
    }
  );
  if (!queued.ok) return NextResponse.json(queued.body, { status: queued.status });

  return NextResponse.json({ ok: true, creative_id: creativeId, charged: queued.charged });
}
