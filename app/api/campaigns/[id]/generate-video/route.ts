import { NextResponse } from "next/server";
import { queueChargedJob, creditCostFor } from "@/lib/credits";
import { checkGenerationBudget, budgetExceededMessage } from "@/lib/generationBudget";
import { resolveGenerationModel } from "@/lib/generationSettings";
import { currentWorkspaceId, workspaceRequiredResponse } from "@/lib/workspace";
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

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const ws = await currentWorkspaceId();
  if (!ws) return workspaceRequiredResponse();

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

  // Operator-set daily credit budget (0119) — the real rate ceiling on top of the count backstop.
  const budget = await checkGenerationBudget(admin, ws, creditCostFor("generate_video"));
  if (!budget.allowed) {
    return NextResponse.json({ error: budgetExceededMessage(budget) }, { status: 429 });
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

  // Resolved at QUEUE time so the job records the model it was queued with — the worker
  // re-runs stages on retry, and reading settings there could repoint a job mid-flight.
  // Body is optional on these routes — they were POST-with-no-body until models became
  // selectable, and every existing caller still sends none. A parse failure means "no override".
  const overrideModel: unknown = await req
    .json()
    .then((b: unknown) => (b as { model?: unknown } | null)?.model)
    .catch(() => undefined);
  const chosenModel = await resolveGenerationModel(supabase, ws, "video", overrideModel);

  const queued = await queueChargedJob(
    supabase,
    { workspace_id: ws, type: "generate_video", payload: { campaign_id: params.id, model_id: chosenModel.id } },
    {
      // Roll back the claim if the insert failed OR the charge was declined, so the campaign
      // isn't stuck "generating" forever after a job that will never run.
      onRollback: async () => {
        await admin.from("campaigns").update({ video_status: "none" }).eq("id", params.id);
      },
    }
  );
  if (!queued.ok) return NextResponse.json(queued.body, { status: queued.status });

  return NextResponse.json({ ok: true, charged: queued.charged });
}
