import { NextResponse } from "next/server";
import { currentWorkspaceId } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

// Image generation used to be usage-tracked only (like Anthropic calls) — cheap and structurally
// rare while it was one button per campaign. Per-item generation (app/api/campaign-creatives/
// generate/route.ts) multiplies the realistic volume, so this now shares a pooled per-user daily
// cap with generate_creative_image — a client can't dodge it by using this legacy route instead.
// Currently a nominal runaway-loop backstop, not a real budget control (the user is testing
// solo) — revisit before opening this beyond solo testing.
const MAX_CREATIVE_IMAGE_GENERATIONS_PER_DAY = 100;

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
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count } = await admin
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", ws)
    .in("type", ["generate_ad_image", "generate_creative_image"])
    .gte("created_at", since);
  if ((count ?? 0) >= MAX_CREATIVE_IMAGE_GENERATIONS_PER_DAY) {
    return NextResponse.json(
      { error: `Daily image generation limit reached (${MAX_CREATIVE_IMAGE_GENERATIONS_PER_DAY}/day)` },
      { status: 429 }
    );
  }

  // jobs RLS already permits an authenticated user to insert their own row directly (same
  // pattern as app/api/promote/route.ts) — no admin client needed for this insert.
  const { error } = await supabase.from("jobs").insert({
    user_id: user.id,
    type: "generate_ad_image",
    payload: { campaign_id: params.id },
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
