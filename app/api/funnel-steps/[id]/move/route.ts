import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { rerenderFunnelSequence } from "@/lib/funnelSteps";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const { data: ws } = await supabase.rpc("current_workspace_id");

  const stepId = params.id;
  const body = await req.json().catch(() => ({}));
  const direction = body.direction === "up" || body.direction === "down" ? body.direction : null;
  if (!direction) {
    return NextResponse.json({ error: "invalid direction" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: step } = await admin
    .from("funnel_steps")
    .select("campaign_id")
    .eq("id", stepId)
    .eq("workspace_id", ws)
    .maybeSingle();
  if (!step) {
    return NextResponse.json({ error: "step not found" }, { status: 404 });
  }

  const { error: rpcErr } = await supabase.rpc("move_funnel_step", {
    p_step_id: stepId,
    p_direction: direction,
  });
  if (rpcErr) {
    return NextResponse.json({ error: rpcErr.message }, { status: 400 });
  }

  await rerenderFunnelSequence(admin, step.campaign_id, user.id);

  return NextResponse.json({ ok: true });
}
