import { NextResponse } from "next/server";
import { currentWorkspaceId, workspaceRequiredResponse } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { validateTracking } from "@/lib/engine/renderPages";

export const dynamic = "force-dynamic";

// Site-wide analytics for the public blog (0113) — the same tracking shape a funnel carries
// per-campaign, saved once and injected into every public post and index page at serve time.
// Clarity is the field that answers "heatmaps for posts"; funnels already carry their own.
//
// validateTracking() is the security boundary, same as the campaign route: pasted snippets are
// reduced to bare provider IDs and the app renders its own code-owned snippet — raw tenant HTML
// must never reach pages served on this origin. Blog pages render at serve time, so a save takes
// effect on the next request with no re-render sweep.
export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  const ws = await currentWorkspaceId();
  if (!ws) return workspaceRequiredResponse();

  const body = await req.json().catch(() => ({}));
  const result = validateTracking(body);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

  // blog_settings is legacy user-keyed (its upsert conflict target is user_id — see
  // app/api/blog/settings/route.ts, which this mirrors exactly so the two writers can't disagree
  // about which row is the blog's).
  const admin = createAdminClient();
  const { error } = await admin
    .from("blog_settings")
    .upsert({ user_id: user.id, tracking: result.tracking, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  if (error) return NextResponse.json({ error: "failed to save" }, { status: 500 });

  return NextResponse.json({ ok: true, tracking: result.tracking });
}
