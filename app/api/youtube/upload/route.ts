import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { refreshGoogleAccessToken, uploadYoutubeVideo, GoogleApiError } from "@/lib/google/client";
import { downloadCampaignVideo } from "@/lib/supabase/storage";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const body = await req.json();
  const title = (body.title as string | undefined)?.trim();
  const description = (body.description as string | undefined) ?? "";
  const campaignId = body.campaign_id as string | undefined;
  const idempotencyKey = body.idempotency_key as string | undefined;

  if (!title || !campaignId || !idempotencyKey) {
    return NextResponse.json(
      { error: "title, campaign_id, and idempotency_key are required" },
      { status: 400 }
    );
  }

  const { data: owns } = await supabase.rpc("assert_owns_campaign", { p_campaign_id: campaignId });
  if (!owns) return NextResponse.json({ error: "campaign not found" }, { status: 404 });

  const admin = createAdminClient();

  const { data: existingPost } = await admin
    .from("youtube_posts")
    .select("youtube_video_id")
    .eq("user_id", user.id)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (existingPost) {
    return NextResponse.json({ ok: true, video_id: existingPost.youtube_video_id, deduped: true });
  }

  const { data: conn } = await admin
    .from("youtube_connections")
    .select("id, access_token_secret_id, refresh_token_secret_id, token_expires_at")
    .eq("user_id", user.id)
    .single();
  if (!conn) return NextResponse.json({ error: "YouTube not connected" }, { status: 404 });

  const { data: campaign } = await admin
    .from("campaigns")
    .select("video_path, video_status")
    .eq("id", campaignId)
    .eq("user_id", user.id)
    .single();
  if (!campaign?.video_path || campaign.video_status !== "ready") {
    return NextResponse.json({ error: "no ready video available for this campaign" }, { status: 400 });
  }

  let accessToken: string;
  const expiresAt = conn.token_expires_at ? new Date(conn.token_expires_at).getTime() : 0;
  const needsRefresh = expiresAt < Date.now() + 2 * 60_000;

  if (needsRefresh && conn.refresh_token_secret_id) {
    const { data: refreshToken } = await admin.rpc("get_oauth_secret", {
      p_secret_id: conn.refresh_token_secret_id,
    });
    if (!refreshToken) {
      return NextResponse.json({ error: "could not refresh YouTube connection" }, { status: 500 });
    }
    try {
      const refreshed = await refreshGoogleAccessToken(refreshToken);
      accessToken = refreshed.access_token;

      const { data: newSecretId, error: storeErr } = await admin.rpc("store_oauth_secret", {
        p_token: accessToken,
        p_name: `youtube_access_token_${user.id}`,
      });
      if (storeErr) throw new Error(storeErr.message);

      const oldSecretId = conn.access_token_secret_id;
      await admin
        .from("youtube_connections")
        .update({
          access_token_secret_id: newSecretId,
          token_expires_at: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
          status: "connected",
        })
        .eq("id", conn.id);
      await admin.rpc("delete_oauth_secret", { p_secret_id: oldSecretId });
    } catch {
      await admin.from("youtube_connections").update({ status: "needs_reconnect" }).eq("id", conn.id);
      return NextResponse.json({ error: "YouTube connection needs to be reconnected" }, { status: 409 });
    }
  } else {
    const { data: token } = await admin.rpc("get_oauth_secret", { p_secret_id: conn.access_token_secret_id });
    if (!token) return NextResponse.json({ error: "could not retrieve YouTube token" }, { status: 500 });
    accessToken = token;
  }

  try {
    // Streams bytes directly to YouTube — never needs the campaign-videos bucket to be public.
    const bytes = await downloadCampaignVideo(campaign.video_path);
    const uploaded = await uploadYoutubeVideo(accessToken, bytes, { title, description });

    await admin.from("youtube_posts").insert({
      user_id: user.id,
      campaign_id: campaignId,
      youtube_video_id: uploaded.id,
      title,
      idempotency_key: idempotencyKey,
    });

    return NextResponse.json({ ok: true, video_id: uploaded.id });
  } catch (err: any) {
    if (err instanceof GoogleApiError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    return NextResponse.json({ error: err?.message ?? "Failed to upload" }, { status: 502 });
  }
}
