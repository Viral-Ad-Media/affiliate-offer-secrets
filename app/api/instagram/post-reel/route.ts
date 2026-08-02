import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isTokenError, createIgReelContainer, getIgContainerStatus, publishIgMedia } from "@/lib/meta/client";
import { createSignedVideoUrl } from "@/lib/supabase/storage";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // container-processing poll below can take up to ~20s

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Reel container processing (Meta re-encoding the video) is async on Meta's side, unlike photo
// containers — bounded synchronous poll here (short AI-generated clips process quickly in the
// common case). On timeout, the container may still finish shortly after; the client can just
// retry the whole post, which is simple and cheap for the expected clip length in this app.
async function waitForContainerReady(containerId: string, pageToken: string): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const status = await getIgContainerStatus(containerId, pageToken);
    if (status === "FINISHED") return;
    if (status === "ERROR" || status === "EXPIRED") {
      throw new Error(`Instagram rejected the video during processing (${status})`);
    }
    await sleep(2000);
  }
  throw new Error("Instagram is still processing the video — try posting again in a moment");
}

export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const { data: ws } = await supabase.rpc("current_workspace_id");

  const body = await req.json();
  const igUserId = body.ig_user_id as string | undefined;
  const caption = (body.caption as string | undefined)?.trim();
  const campaignId = body.campaign_id as string | undefined;
  const idempotencyKey = body.idempotency_key as string | undefined;

  if (!igUserId || !caption || !campaignId || !idempotencyKey) {
    return NextResponse.json(
      { error: "ig_user_id, caption, campaign_id, and idempotency_key are required" },
      { status: 400 }
    );
  }

  const { data: owns, error: ownErr } = await supabase.rpc("assert_owns_ig_account", {
    p_ig_user_id: igUserId,
  });
  if (ownErr || !owns) {
    return NextResponse.json({ error: "Instagram account not found for this user" }, { status: 404 });
  }

  const admin = createAdminClient();

  const { data: existingPost } = await admin
    .from("instagram_posts")
    .select("ig_media_id")
    .eq("workspace_id", ws)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (existingPost) {
    return NextResponse.json({ ok: true, ig_media_id: existingPost.ig_media_id, deduped: true });
  }

  const { data: igAccount } = await admin
    .from("meta_instagram_accounts")
    .select("linked_page_id")
    .eq("workspace_id", ws)
    .eq("ig_user_id", igUserId)
    .single();
  if (!igAccount) return NextResponse.json({ error: "Instagram account not found" }, { status: 404 });

  // Double-scoped by user_id AND page_id — never trust linked_page_id alone as sufficient
  // scoping, same pattern as the photo-posting route.
  const { data: page } = await admin
    .from("meta_pages")
    .select("page_token_secret_id")
    .eq("workspace_id", ws)
    .eq("page_id", igAccount.linked_page_id)
    .single();
  if (!page) return NextResponse.json({ error: "linked Page not found" }, { status: 404 });

  const { data: pageToken, error: tokenErr } = await admin.rpc("get_meta_secret", {
    p_secret_id: page.page_token_secret_id,
  });
  if (tokenErr || !pageToken) {
    return NextResponse.json({ error: "could not retrieve page token" }, { status: 500 });
  }

  const { data: campaign } = await admin
    .from("campaigns")
    .select("video_path, video_status")
    .eq("id", campaignId)
    .eq("workspace_id", ws)
    .single();
  if (!campaign?.video_path || campaign.video_status !== "ready") {
    return NextResponse.json({ error: "no ready video available for this campaign" }, { status: 400 });
  }

  try {
    const videoUrl = await createSignedVideoUrl(campaign.video_path);
    const container = await createIgReelContainer(igUserId, pageToken, videoUrl, caption);
    await waitForContainerReady(container.id, pageToken);
    const published = await publishIgMedia(igUserId, pageToken, container.id);

    await admin.from("instagram_posts").insert({
      user_id: user.id,
      campaign_id: campaignId,
      ig_user_id: igUserId,
      ig_media_id: published.id,
      caption,
      idempotency_key: idempotencyKey,
    });

    return NextResponse.json({ ok: true, ig_media_id: published.id });
  } catch (err: any) {
    if (isTokenError(err)) {
      await admin
        .from("meta_pages")
        .update({ status: "needs_reconnect" })
        .eq("workspace_id", ws)
        .eq("page_id", igAccount.linked_page_id);
    }
    return NextResponse.json({ error: err?.message ?? "Failed to publish" }, { status: 502 });
  }
}
