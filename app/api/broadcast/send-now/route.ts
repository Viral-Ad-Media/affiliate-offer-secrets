import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const MAX_SUBJECT = 200;
const MAX_BODY = 100_000;

// Emails → Broadcast: create-and-activate a one-off send in a single call.
//
// A broadcast IS a sequence with one delay_days=0 step (kind='broadcast', 0035), so this route
// only orchestrates the three EXISTING RPCs — every ownership check, the pooled daily cap, the
// unsubscribe footer and broadcast_sends auditing come along unchanged. Deliberately no new
// delivery path: activation just enrols the audience and the 1-minute sweep does the rest.
export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const subject = typeof body.subject === "string" ? body.subject.trim().slice(0, MAX_SUBJECT) : "";
  const bodyMd = typeof body.body_md === "string" ? body.body_md.slice(0, MAX_BODY) : "";
  const audienceType = body.audience_type === "campaign" ? "campaign" : "all";
  const campaignId = typeof body.campaign_id === "string" ? body.campaign_id : null;
  const name = (typeof body.name === "string" && body.name.trim() ? body.name.trim() : subject).slice(0, 200);

  if (!subject) return NextResponse.json({ error: "subject required" }, { status: 400 });
  if (!bodyMd.trim()) return NextResponse.json({ error: "message required" }, { status: 400 });
  if (audienceType === "campaign" && !campaignId) {
    return NextResponse.json({ error: "pick a campaign for a campaign audience" }, { status: 400 });
  }

  // create_broadcast_sequence re-checks campaign ownership itself (assert_owns_campaign) — this
  // route never needs to be trusted for that.
  const { data: sequenceId, error: createErr } = await supabase.rpc("create_broadcast_sequence", {
    p_name: name,
    p_audience_type: audienceType,
    p_campaign_id: campaignId,
    p_kind: "broadcast",
  });
  if (createErr || !sequenceId) {
    return NextResponse.json({ error: createErr?.message ?? "could not create broadcast" }, { status: 400 });
  }

  const { error: stepErr } = await supabase.rpc("upsert_broadcast_step", {
    p_sequence_id: sequenceId,
    p_step_index: 0,
    p_delay_days: 0,
    p_subject: subject,
    p_body_md: bodyMd,
  });
  if (stepErr) {
    // Roll the draft back so a half-built broadcast never lingers in the history list.
    await supabase.rpc("delete_broadcast_sequence", { p_sequence_id: sequenceId });
    return NextResponse.json({ error: stepErr.message }, { status: 400 });
  }

  const { error: activateErr } = await supabase.rpc("activate_broadcast_sequence", { p_sequence_id: sequenceId });
  if (activateErr) {
    await supabase.rpc("delete_broadcast_sequence", { p_sequence_id: sequenceId });
    return NextResponse.json({ error: activateErr.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, sequence_id: sequenceId });
}
