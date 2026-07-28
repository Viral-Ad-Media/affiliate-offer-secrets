import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

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

  if (published) {
    const { data: campaign } = await admin
      .from("campaigns")
      .select("status, bridge_html")
      .eq("id", campaignId)
      .single();
    if (!campaign || campaign.status !== "ready" || !campaign.bridge_html) {
      return NextResponse.json(
        { error: "Bridge page isn't ready to publish yet — the campaign kit must finish building first" },
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
