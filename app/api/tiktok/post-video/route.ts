import { NextResponse } from "next/server";
import { currentWorkspaceId } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { initTiktokVideoPost, getTiktokPostStatus, refreshTiktokToken, TiktokApiError } from "@/lib/tiktok/client";
import { createSignedVideoUrl } from "@/lib/supabase/storage";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // status poll below can take up to ~20s

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const ws = await currentWorkspaceId();

  const body = await req.json();
  const caption = (body.caption as string | undefined)?.trim();
  const campaignId = body.campaign_id as string | undefined;
  const idempotencyKey = body.idempotency_key as string | undefined;

  if (!caption || !campaignId || !idempotencyKey) {
    return NextResponse.json(
      { error: "caption, campaign_id, and idempotency_key are required" },
      { status: 400 }
    );
  }

  // The campaign_id here is a client-supplied foreign reference, same reasoning as every other
  // posting route in this app — must verify it belongs to the caller before using it for
  // anything, never trust it implicitly.
  const { data: owns } = await supabase.rpc("assert_owns_campaign", { p_campaign_id: campaignId });
  if (!owns) return NextResponse.json({ error: "campaign not found" }, { status: 404 });

  const admin = createAdminClient();

  const { data: existingPost } = await admin
    .from("tiktok_posts")
    .select("tiktok_publish_id")
    .eq("workspace_id", ws)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (existingPost) {
    return NextResponse.json({ ok: true, publish_id: existingPost.tiktok_publish_id, deduped: true });
  }

  // No foreign resource id here — always the caller's own connection, same reasoning as
  // app/api/mail/send/route.ts.
  const { data: conn } = await admin
    .from("tiktok_connections")
    .select("id, access_token_secret_id, refresh_token_secret_id, token_expires_at")
    .eq("workspace_id", ws)
    .single();
  if (!conn) return NextResponse.json({ error: "TikTok not connected" }, { status: 404 });

  const { data: campaign } = await admin
    .from("campaigns")
    .select("video_path, video_status")
    .eq("id", campaignId)
    .eq("workspace_id", ws)
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
      return NextResponse.json({ error: "could not refresh TikTok connection" }, { status: 500 });
    }
    try {
      const refreshed = await refreshTiktokToken(refreshToken);
      accessToken = refreshed.access_token;

      const [{ data: newAccessSecretId }, { data: newRefreshSecretId }] = await Promise.all([
        admin.rpc("store_oauth_secret", { p_token: refreshed.access_token, p_name: `tiktok_access_token_${user.id}` }),
        admin.rpc("store_oauth_secret", { p_token: refreshed.refresh_token, p_name: `tiktok_refresh_token_${user.id}` }),
      ]);

      const oldAccessSecretId = conn.access_token_secret_id;
      const oldRefreshSecretId = conn.refresh_token_secret_id;
      await admin
        .from("tiktok_connections")
        .update({
          access_token_secret_id: newAccessSecretId,
          refresh_token_secret_id: newRefreshSecretId,
          token_expires_at: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
          status: "connected",
        })
        .eq("id", conn.id);
      // Delete the now-orphaned secrets immediately — same hygiene as the Google refresh path.
      await Promise.all([
        admin.rpc("delete_oauth_secret", { p_secret_id: oldAccessSecretId }),
        admin.rpc("delete_oauth_secret", { p_secret_id: oldRefreshSecretId }),
      ]);
    } catch {
      await admin.from("tiktok_connections").update({ status: "needs_reconnect" }).eq("id", conn.id);
      return NextResponse.json({ error: "TikTok connection needs to be reconnected" }, { status: 409 });
    }
  } else {
    const { data: token } = await admin.rpc("get_oauth_secret", { p_secret_id: conn.access_token_secret_id });
    if (!token) return NextResponse.json({ error: "could not retrieve TikTok token" }, { status: 500 });
    accessToken = token;
  }

  try {
    const videoUrl = await createSignedVideoUrl(campaign.video_path);
    const publishId = await initTiktokVideoPost(accessToken, videoUrl, caption);

    for (let attempt = 0; attempt < 10; attempt++) {
      const status = await getTiktokPostStatus(accessToken, publishId);
      if (status === "PUBLISH_COMPLETE") break;
      if (status === "FAILED") throw new Error("TikTok reported the post failed to process");
      if (attempt === 9) {
        // Still processing — not an error. The post will likely finish shortly; log it as
        // submitted rather than blocking the request indefinitely.
        break;
      }
      await sleep(2000);
    }

    await admin.from("tiktok_posts").insert({
      user_id: user.id,
      campaign_id: campaignId,
      tiktok_publish_id: publishId,
      caption,
      idempotency_key: idempotencyKey,
    });

    return NextResponse.json({ ok: true, publish_id: publishId });
  } catch (err: any) {
    if (err instanceof TiktokApiError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    return NextResponse.json({ error: err?.message ?? "Failed to publish" }, { status: 502 });
  }
}
