import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createSignedVideoUrl } from "@/lib/supabase/storage";

export const dynamic = "force-dynamic";

// Mirrors app/api/campaigns/[id]/video-url/route.ts — lets the owning tenant preview their own
// generated per-item video. campaign_creatives' own owner-select RLS is the implicit ownership
// check (same reasoning app/api/meta/ads/activate/route.ts already relies on for ad_launches),
// so no separate assert_owns_campaign call is needed here.
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const { data: creative } = await supabase
    .from("campaign_creatives")
    .select("video_path, status")
    .eq("id", params.id)
    .maybeSingle();
  if (!creative?.video_path || creative.status !== "ready") {
    return NextResponse.json({ error: "no ready video for this creative" }, { status: 404 });
  }

  const url = await createSignedVideoUrl(creative.video_path, 600);
  return NextResponse.json({ url });
}
