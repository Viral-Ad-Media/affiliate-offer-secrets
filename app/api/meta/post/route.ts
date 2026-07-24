import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isTokenError, publishPhoto, publishToFeed } from "@/lib/meta/client";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const body = await req.json();
  const pageId = body.page_id as string | undefined;
  const message = (body.message as string | undefined)?.trim();
  const imageUrl = body.image_url as string | undefined;
  const campaignId = body.campaign_id as string | undefined;
  const idempotencyKey = body.idempotency_key as string | undefined;

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
    .eq("user_id", user.id)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (existingPost) {
    return NextResponse.json({ ok: true, fb_post_id: existingPost.fb_post_id, deduped: true });
  }

  const { data: page } = await admin
    .from("meta_pages")
    .select("page_token_secret_id")
    .eq("user_id", user.id)
    .eq("page_id", pageId)
    .single();
  if (!page) return NextResponse.json({ error: "page not found" }, { status: 404 });

  const { data: pageToken, error: tokenErr } = await admin.rpc("get_meta_secret", {
    p_secret_id: page.page_token_secret_id,
  });
  if (tokenErr || !pageToken) {
    return NextResponse.json({ error: "could not retrieve page token" }, { status: 500 });
  }

  try {
    let fbPostId: string;
    if (imageUrl) {
      const result = await publishPhoto(pageId, pageToken, imageUrl, message);
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
        .eq("user_id", user.id)
        .eq("page_id", pageId);
    }
    return NextResponse.json({ error: err?.message ?? "Failed to publish" }, { status: 502 });
  }
}
