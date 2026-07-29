import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { rerenderFunnelSequence } from "@/lib/funnelSteps";

export const dynamic = "force-dynamic";

const STEP_TYPES = ["thank_you", "upsell", "order"];

// Ownership is checked inside add_funnel_step() itself (auth.uid() = user_id on the campaigns
// join) — this route's job is just to call it, then re-render the sequence, since RPCs are plain
// SQL and can't call the TypeScript render functions in lib/engine/renderPages.ts.
export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const campaignId = typeof body.campaign_id === "string" ? body.campaign_id : "";
  const stepType = typeof body.step_type === "string" ? body.step_type : "";
  if (!campaignId || !STEP_TYPES.includes(stepType)) {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }

  const { data: step, error: rpcErr } = await supabase.rpc("add_funnel_step", {
    p_campaign_id: campaignId,
    p_step_type: stepType,
  });
  if (rpcErr || !step) {
    return NextResponse.json({ error: rpcErr?.message ?? "failed to add step" }, { status: 400 });
  }

  const admin = createAdminClient();
  await rerenderFunnelSequence(admin, campaignId, user.id);

  return NextResponse.json({ ok: true, step });
}
