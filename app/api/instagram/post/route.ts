import { NextResponse } from "next/server";
import { currentWorkspaceId, workspaceRequiredResponse } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isTokenError, createIgMediaContainer, publishIgMedia } from "@/lib/meta/client";
import { isOwnCloudinaryUrl } from "@/lib/images/validate";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const ws = await currentWorkspaceId();
  if (!ws) return workspaceRequiredResponse();

  const body = await req.json();
  const igUserId = body.ig_user_id as string | undefined;
  const caption = (body.caption as string | undefined)?.trim();
  const campaignId = body.campaign_id as string | undefined;
  const idempotencyKey = body.idempotency_key as string | undefined;
  // Optional per-item creative selector — post this social post's / ad angle's own generated image.
  const creativeSource = body.creative_source as string | undefined;
  const creativeIndex = body.creative_index;

  if (!igUserId || !caption || !campaignId || !idempotencyKey) {
    return NextResponse.json(
      { error: "ig_user_id, caption, campaign_id, and idempotency_key are required" },
      { status: 400 }
    );
  }

  // Ownership check FIRST, via the RLS-respecting user-scoped client — same shape as
  // assert_owns_meta_page in app/api/meta/post/route.ts.
  const { data: owns, error: ownErr } = await supabase.rpc("assert_owns_ig_account", {
    p_ig_user_id: igUserId,
  });
  if (ownErr || !owns) {
    return NextResponse.json({ error: "Instagram account not found for this user" }, { status: 404 });
  }

  const admin = createAdminClient();

  // Idempotency: (user_id, idempotency_key) is unique — a double-click/client retry is a safe no-op.
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
  // scoping, mirroring /api/meta/post's existing pattern. Design-review fix.
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

  // Prefer THIS post's own generated creative when one is a hosted URL Instagram can fetch —
  // resolved via the RLS client, so only a creative the caller owns can be used. Every per-item
  // image creative is a Cloudinary URL today; a (legacy) data-URI creative simply falls through to
  // the campaign hero below, since Instagram's media endpoint needs a fetchable URL, not bytes.
  let imageUrl: string | null = null;
  if (
    (creativeSource === "social_post" || creativeSource === "fb_ad_angle") &&
    Number.isInteger(creativeIndex)
  ) {
    const { data: creative } = await supabase
      .from("campaign_creatives")
      .select("image_data_url")
      .eq("campaign_id", campaignId)
      .eq("source", creativeSource)
      .eq("item_index", creativeIndex as number)
      .eq("kind", "image")
      .eq("status", "ready")
      .maybeSingle();
    const ref = creative?.image_data_url as string | null | undefined;
    if (isOwnCloudinaryUrl(ref)) imageUrl = ref;
  }

  if (!imageUrl) {
    const { data: campaign } = await admin
      .from("campaigns")
      .select("embedded_image_data_url")
      .eq("id", campaignId)
      .eq("workspace_id", ws)
      .single();
    if (!campaign?.embedded_image_data_url) {
      return NextResponse.json({ error: "no image available for this campaign" }, { status: 400 });
    }

    // A migrated campaign already has a public, fetchable image URL — hand Instagram that directly
    // rather than proxying our own origin through to a redirect. The /api/public/campaign-image
    // route still exists and still works (it redirects for Cloudinary values), but going straight
    // to the CDN removes a hop and, more importantly, removes any dependence on Instagram's fetcher
    // following a 302 — behaviour this codebase has not verified and should not assume.
    //
    // Legacy campaigns whose hero is still inline bytes keep using the proxy route, which is the
    // only thing that can turn a data: URI into something Instagram can fetch.
    const stored = campaign.embedded_image_data_url as string;
    imageUrl = isOwnCloudinaryUrl(stored)
      ? stored
      : `${process.env.NEXT_PUBLIC_APP_URL}/api/public/campaign-image/${campaignId}`;
  }

  try {
    const container = await createIgMediaContainer(igUserId, pageToken, imageUrl, caption);
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
