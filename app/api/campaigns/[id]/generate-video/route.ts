import { NextResponse } from "next/server";
import { currentWorkspaceId } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

// Design-review fix #4: video generation costs a materially different order of magnitude than a
// text/image call, and nothing else stops a client from re-queuing generate_video against the
// same campaign repeatedly — two independent, cheap guardrails instead of full credit-gating.
// Pooled with generate_creative_video (app/api/campaign-creatives/generate/route.ts) under one
// shared per-user daily count — a client can't dodge the cap by using the per-item route instead
// of this one. Currently a nominal runaway-loop backstop, not a real budget control (the user is
// testing solo) — revisit before opening this beyond solo testing.
const MAX_VIDEO_GENERATIONS_PER_DAY = 100;

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const ws = await currentWorkspaceId();

  const { data: owns } = await supabase.rpc("assert_owns_campaign", { p_campaign_id: params.id });
  if (!owns) return NextResponse.json({ error: "campaign not found" }, { status: 404 });

  const admin = createAdminClient();

  // Fix #4b: per-user daily rate cap, checked before the concurrency claim below.
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count } = await admin
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", ws)
    .in("type", ["generate_video", "generate_creative_video"])
    .gte("created_at", since);
  if ((count ?? 0) >= MAX_VIDEO_GENERATIONS_PER_DAY) {
    return NextResponse.json(
      { error: `Daily video generation limit reached (${MAX_VIDEO_GENERATIONS_PER_DAY}/day)` },
      { status: 429 }
    );
  }

  // Fix #4a: atomic concurrency claim — a single UPDATE...WHERE...RETURNING (same
  // optimistic-concurrency idiom used for every job stage-advance in this codebase), not a
  // separate check-then-write, so two simultaneous requests can't both win.
  const { data: claimed, error: claimErr } = await admin
    .from("campaigns")
    .update({ video_status: "generating", video_error: null, updated_at: new Date().toISOString() })
    .eq("id", params.id)
    .neq("video_status", "generating")
    .select("id")
    .maybeSingle();
  if (claimErr) return NextResponse.json({ error: claimErr.message }, { status: 500 });
  if (!claimed) {
    return NextResponse.json(
      { error: "A video is already generating for this campaign" },
      { status: 409 }
    );
  }

  const { error } = await supabase.from("jobs").insert({
    user_id: user.id,
    type: "generate_video",
    payload: { campaign_id: params.id },
  });
  if (error) {
    // Roll back the claim if the job insert itself failed, so the campaign isn't stuck
    // "generating" forever.
    await admin.from("campaigns").update({ video_status: "none" }).eq("id", params.id);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
