import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// Image generation is usage-tracked only (like Anthropic calls) — no concurrency/rate guard
// needed, it's cheap and structurally rare per the design review's cost-tracing (unlike video).
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const { data: owns } = await supabase.rpc("assert_owns_campaign", { p_campaign_id: params.id });
  if (!owns) return NextResponse.json({ error: "campaign not found" }, { status: 404 });

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
