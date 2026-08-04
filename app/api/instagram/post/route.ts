import { NextResponse } from "next/server";
import { currentWorkspaceId } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isTokenError, createIgMediaContainer, publishIgMedia } from "@/lib/meta/client";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const ws = await currentWorkspaceId();

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

  const { data: campaign } = await admin
    .from("campaigns")
    .select("embedded_image_data_url")
    .eq("id", campaignId)
    .eq("workspace_id", ws)
    .single();
  if (!campaign?.embedded_image_data_url) {
    return NextResponse.json({ error: "no image available for this campaign" }, { status: 400 });
  }

  const imageUrl = `${process.env.NEXT_PUBLIC_APP_URL}/api/public/campaign-image/${campaignId}`;

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
