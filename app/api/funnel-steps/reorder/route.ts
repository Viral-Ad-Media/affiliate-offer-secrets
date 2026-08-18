import { NextResponse } from "next/server";
import { currentWorkspaceId } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { rerenderFunnelSequence } from "@/lib/funnelSteps";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Apply a dragged step order. Mirrors the move route exactly: the RPC is the authorization
 * boundary (it resolves the campaign's workspace and checks membership, and refuses a stale,
 * duplicate, partial or cross-variant list), and the re-render afterwards is NOT optional — every
 * step's CTA href and the opt-in page's next-step redirect are baked into stored HTML, so a
 * reorder that skipped it would keep sending real visitors along the OLD order while the map
 * showed the new one.
 */
export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const ws = await currentWorkspaceId();
  if (!ws) return NextResponse.json({ error: "no workspace" }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const campaignId = typeof body.campaign_id === "string" ? body.campaign_id : null;
  const stepIds = Array.isArray(body.step_ids)
    ? body.step_ids.filter((v: unknown): v is string => typeof v === "string")
    : [];
  if (!campaignId || stepIds.length === 0) {
    return NextResponse.json({ error: "invalid order" }, { status: 400 });
  }

  const { error: rpcErr } = await supabase.rpc("reorder_funnel_steps", {
    p_campaign_id: campaignId,
    p_step_ids: stepIds,
  });
  if (rpcErr) {
    return NextResponse.json({ error: rpcErr.message }, { status: 400 });
  }

  await rerenderFunnelSequence(createAdminClient(), campaignId, ws);

  return NextResponse.json({ ok: true });
}
