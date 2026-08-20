import { NextResponse } from "next/server";
import { currentWorkspaceId, workspaceRequiredResponse } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isTokenError, publishPhotoBytes, publishToFeed } from "@/lib/meta/client";
import { fetchImageAsDataUrl, imageRefToDataUrl } from "@/lib/engine/images";

// Ad creatives run large (full-res AI images); the vendor-photo cap (200KB) is far too small here.
const MAX_CREATIVE_BYTES = 10_000_000;

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
  const pageId = body.page_id as string | undefined;
  const message = (body.message as string | undefined)?.trim();
  const imageUrl = body.image_url as string | undefined;
  const campaignId = body.campaign_id as string | undefined;
  const idempotencyKey = body.idempotency_key as string | undefined;
  // Optional per-item creative selector: post THIS ad angle's / social post's own generated image
  // instead of the campaign-level vendor photo. Read through the RLS client below, so a forged
  // campaign_id resolves nothing rather than exposing another tenant's creative.
  const creativeSource = body.creative_source as string | undefined;
  const creativeIndex = body.creative_index;

  if (!pageId || !message || !idempotencyKey) {
    return NextResponse.json(
      { error: "page_id, message, and idempotency_key are required" },
      { status: 400 }
    );
  }

  // Ownership check FIRST, via the RLS-respecting user-scoped client — before the admin client
  // is ever reached for. Facebook Page IDs aren't secret; without this check, any authenticated
  // user could pass another tenant's page_id and post to it using that tenant's stored token.
  const { data: owns, error: ownErr } = await supabase.rpc("assert_owns_meta_page", {
    p_page_id: pageId,
  });
  if (ownErr || !owns) {
    return NextResponse.json({ error: "page not found for this account" }, { status: 404 });
  }

  const admin = createAdminClient();

  // Idempotency: (user_id, idempotency_key) is unique — a double-click/client retry is a safe no-op.
  const { data: existingPost } = await admin
    .from("meta_posts")
    .select("fb_post_id")
    .eq("workspace_id", ws)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (existingPost) {
    return NextResponse.json({ ok: true, fb_post_id: existingPost.fb_post_id, deduped: true });
  }

  const { data: page } = await admin
    .from("meta_pages")
    .select("page_token_secret_id")
    .eq("workspace_id", ws)
    .eq("page_id", pageId)
    .single();
  if (!page) return NextResponse.json({ error: "page not found" }, { status: 404 });

  const { data: pageToken, error: tokenErr } = await admin.rpc("get_meta_secret", {
    p_secret_id: page.page_token_secret_id,
  });
  if (tokenErr || !pageToken) {
    return NextResponse.json({ error: "could not retrieve page token" }, { status: 500 });
  }

  // A specific post's own generated creative wins over the campaign-level image, resolved through
  // the RLS-scoped client so it can only ever be one the caller owns.
  let creativeRef: string | null = null;
  if (
    campaignId &&
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
    creativeRef = (creative?.image_data_url as string | null) ?? null;
  }

  try {
    let fbPostId: string;
    // Never hotlink a raw image URL into a live post — fetch real bytes server-side first (same
    // reasoning as CLAUDE.md content rule 9). Prefer the per-item creative (imageRefToDataUrl
    // handles both a data URI and one of our Cloudinary URLs); else the passed vendor image.
    // Falls back to a text-only post if neither resolves rather than erroring out.
    const imageDataUrl = creativeRef
      ? await imageRefToDataUrl(creativeRef, MAX_CREATIVE_BYTES)
      : imageUrl
        ? await fetchImageAsDataUrl(imageUrl)
        : null;
    if (imageDataUrl) {
      const result = await publishPhotoBytes(pageId, pageToken, imageDataUrl, message);
      fbPostId = result.post_id ?? result.id;
    } else {
      const result = await publishToFeed(pageId, pageToken, message);
      fbPostId = result.id;
    }

    await admin.from("meta_posts").insert({
      user_id: user.id,
      campaign_id: campaignId ?? null,
      page_id: pageId,
      fb_post_id: fbPostId,
      message,
      image_url: imageUrl ?? null,
      idempotency_key: idempotencyKey,
    });

    return NextResponse.json({ ok: true, fb_post_id: fbPostId });
  } catch (err: any) {
    if (isTokenError(err)) {
      await admin
        .from("meta_pages")
        .update({ status: "needs_reconnect" })
        .eq("workspace_id", ws)
        .eq("page_id", pageId);
    }
    return NextResponse.json({ error: err?.message ?? "Failed to publish" }, { status: 502 });
  }
}
