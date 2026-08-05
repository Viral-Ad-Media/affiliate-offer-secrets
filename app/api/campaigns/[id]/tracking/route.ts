import { NextResponse } from "next/server";
import { currentWorkspaceId } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { validateTracking } from "@/lib/engine/renderPages";
import { rerenderFunnelSequence } from "@/lib/funnelSteps";

export const dynamic = "force-dynamic";

// Saves a funnel's analytics/tracking settings (GA4 / GTM / Clarity / Meta Pixel IDs) and
// re-renders every page that funnel serves — the opt-in page, its split-test variants, and every
// step — since page HTML is baked at write time in this codebase (never templated at serve time).
// validateTracking() is the security boundary: these IDs are interpolated into inline <script>
// text served raw to unauthenticated ad traffic, so a value that doesn't match its provider's
// strict anchored format is a hard 400 here (and renders nothing even if it somehow reached the
// DB — renderTrackingHtml re-checks).
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const { data: owns } = await supabase.rpc("assert_owns_campaign", { p_campaign_id: params.id });
  if (!owns) return NextResponse.json({ error: "campaign not found" }, { status: 404 });

  // The workspace, not the user — rerenderFunnelSequence resolves the affiliate id from
  // network_connections, which has been workspace-scoped since the workspace migration.
  const ws = await currentWorkspaceId();
  if (!ws) return NextResponse.json({ error: "no workspace" }, { status: 400 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const result = validateTracking(body);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

  const admin = createAdminClient();
  const { error: updateErr } = await admin
    .from("campaigns")
    .update({ tracking: result.tracking })
    .eq("id", params.id);
  if (updateErr) return NextResponse.json({ error: "failed to save" }, { status: 500 });

  await rerenderFunnelSequence(admin, params.id, ws);

  return NextResponse.json({ ok: true, tracking: result.tracking });
}
