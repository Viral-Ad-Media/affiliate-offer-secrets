import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createSignedVideoUrl } from "@/lib/supabase/storage";

export const dynamic = "force-dynamic";

// Lets the owning tenant preview their own generated video in the dashboard — the
// campaign-videos bucket is private, so even the owner needs a freshly-minted signed URL, never
// a stored/durable one.
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const { data: owns } = await supabase.rpc("assert_owns_campaign", { p_campaign_id: params.id });
  if (!owns) return NextResponse.json({ error: "campaign not found" }, { status: 404 });

  const admin = createAdminClient();
  const { data: campaign } = await admin
    .from("campaigns")
    .select("video_path, video_status")
    .eq("id", params.id)
    .single();
  if (!campaign?.video_path || campaign.video_status !== "ready") {
    return NextResponse.json({ error: "no ready video for this campaign" }, { status: 404 });
  }

  const url = await createSignedVideoUrl(campaign.video_path, 600); // 10 minutes, plenty for a preview
  return NextResponse.json({ url });
}
