import { NextResponse } from "next/server";
import { currentWorkspaceId, workspaceRequiredResponse } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { rerenderFunnelSequence } from "@/lib/funnelSteps";
import { isValidRedirectUrl } from "@/lib/validate";

export const dynamic = "force-dynamic";

const ACTIONS = ["default", "offer", "url", "step"] as const;

// Set one split-test variant's flow (0115): where its opt-ins go next. A route rather than an RPC
// because the destination is BAKED into the variant's stored HTML — the write must re-render, and
// rendering is application code. Re-renders the whole funnel via rerenderFunnelSequence rather
// than hand-rendering one variant: same simplest-correct call the step routes make.
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  const ws = await currentWorkspaceId();
  if (!ws) return workspaceRequiredResponse();

  // RLS-scoped read is the ownership check; the control is refused because its flow IS the
  // funnel's own chain (the campaigns row) — the same reason the DB constraint pins it.
  const { data: variant } = await supabase
    .from("bridge_variants")
    .select("id, campaign_id, is_control, workspace_id")
    .eq("id", params.id)
    .maybeSingle();
  if (!variant || variant.workspace_id !== ws) {
    return NextResponse.json({ error: "Variant not found" }, { status: 404 });
  }
  if (variant.is_control) {
    return NextResponse.json(
      { error: "The control follows the funnel's own flow — edit the funnel's steps instead" },
      { status: 400 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const action = body.next_action as (typeof ACTIONS)[number];
  if (!ACTIONS.includes(action)) {
    return NextResponse.json({ error: "unknown flow" }, { status: 400 });
  }

  let nextUrl: string | null = null;
  let nextStepId: string | null = null;
  if (action === "url") {
    if (typeof body.next_url !== "string" || !isValidRedirectUrl(body.next_url)) {
      return NextResponse.json({ error: "That destination must be a valid http(s) URL" }, { status: 400 });
    }
    nextUrl = body.next_url;
  }
  if (action === "step") {
    // The step must belong to THIS campaign — a foreign step id would bake a URL into a page the
    // caller owns pointing at a funnel they may not.
    const { data: step } = await supabase
      .from("funnel_steps")
      .select("id")
      .eq("id", typeof body.next_step_id === "string" ? body.next_step_id : "00000000-0000-0000-0000-000000000000")
      .eq("campaign_id", variant.campaign_id)
      .maybeSingle();
    if (!step) return NextResponse.json({ error: "That step isn't part of this funnel" }, { status: 400 });
    nextStepId = step.id as string;
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("bridge_variants")
    .update({ next_action: action, next_url: nextUrl, next_step_id: nextStepId, updated_at: new Date().toISOString() })
    .eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Destinations are baked at write time everywhere in this codebase — without this the page
  // keeps sending real traffic down the old flow while the card claims otherwise.
  try {
    await rerenderFunnelSequence(admin, variant.campaign_id as string, ws);
  } catch (e: any) {
    // The flow IS saved by here — report the render failure rather than inviting a retry of a
    // write that already happened.
    return NextResponse.json({ ok: true, warning: `saved, but re-render failed: ${e?.message ?? e}` });
  }
  return NextResponse.json({ ok: true });
}
