import { NextResponse } from "next/server";
import { currentWorkspaceId } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { rerenderFunnelSequence } from "@/lib/funnelSteps";
import { isBuildable, isFunnelStart, MAX_FUNNEL_NAME } from "@/lib/funnelTypes";
import { optInPageCopy, stepPageCopy, stepsForType } from "@/lib/funnelTemplates";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Create a funnel by hand — no AI, no credits, the alternative to Promote.
 *
 * A funnel needs no product. It's a page: a webinar registration, a lead magnet, something to point
 * ads at before an offer is chosen. Requiring one only made people attach an arbitrary product to
 * get past the dialog. An offer can be attached later, on the funnel's own page, and until then the
 * call to action falls back to campaigns.cta_url (or nothing, which renders as a dead "#" rather
 * than a link somewhere unintended).
 *
 * Writes go through the admin client because campaigns' RLS is select-only for clients (0009 —
 * these columns are served raw to unauthenticated ad traffic). The workspace resolved below is the
 * ownership boundary; nothing here takes a caller-supplied id that isn't re-checked against it.
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
  const typeKey = typeof body.type === "string" ? body.type : "";
  const start = body.start;
  const name = (typeof body.name === "string" ? body.name : "").trim().slice(0, MAX_FUNNEL_NAME);

  if (!isFunnelStart(start)) {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }
  // Buildable, not merely known: the picker greys out what this app can't deliver (no branching,
  // no buyer checkout), and the API has to enforce that too — otherwise a direct call creates a
  // "survey funnel" that is really a squeeze page with a misleading name.
  if (!isBuildable(typeKey)) {
    return NextResponse.json({ error: "that funnel type isn't available yet" }, { status: 400 });
  }
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });

  const steps = stepsForType(typeKey) ?? [];
  const admin = createAdminClient();

  const { data: created, error: createErr } = await admin
    .from("campaigns")
    .insert({
      user_id: user.id,
      workspace_id: ws,
      name,
      // Recorded, not just used-and-discarded: the editor's required-elements checklist is keyed
      // off it, and nothing else in the schema says what a funnel was meant to be. Already
      // validated by isBuildable() above, so this is a known key.
      funnel_type: typeKey,
      // 'ready' is what the public serving path gates on (alongside bridge_published), so a
      // hand-built funnel has to carry it or it could never go live. It means "this has something
      // servable", not "an AI kit was generated" — the kit fields stay null.
      status: "ready",
    })
    .select("id")
    .single();
  if (createErr || !created) {
    return NextResponse.json({ error: createErr?.message ?? "failed to create" }, { status: 500 });
  }
  const campaignId = created.id as string;

  const pageCopy = optInPageCopy(typeKey, start, name, null);
  const { error: updErr } = await admin
    .from("campaigns")
    .update({ page_copy: pageCopy, updated_at: new Date().toISOString() })
    .eq("id", campaignId);
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  // Steps are inserted directly rather than through add_funnel_step(): ownership is already
  // established by the workspace above, and this way the whole funnel lands in one pass.
  if (steps.length > 0) {
    const rows = steps.map((stepType, i) => ({
      user_id: user.id,
      workspace_id: ws,
      campaign_id: campaignId,
      step_type: stepType,
      step_index: i + 1,
      page_copy: stepPageCopy(stepType, start, name),
      // Last step sends traffic onward; every earlier one continues the chain.
      cta_action: i === steps.length - 1 ? "hoplink" : "next_step",
    }));
    const { error: stepErr } = await admin.from("funnel_steps").insert(rows);
    if (stepErr) return NextResponse.json({ error: stepErr.message }, { status: 500 });
  }

  // Renders bridge_html and every step's html, and bakes the real hrefs (the opt-in page's
  // redirect to step 1, each step's CTA).
  await rerenderFunnelSequence(admin, campaignId, ws);

  return NextResponse.json({ ok: true, campaign_id: campaignId });
}
