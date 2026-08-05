// Turning a built campaign kit's blog_md into a real blog post. Shared by the manual "Import from
// campaign" route and the engine's build_campaign finalize step, so an auto-created post is
// byte-for-byte what the import button would have produced.
//
// Server-only: takes the admin client (blog tables have no client write grants — 0030) and always
// scopes reads by workspace_id explicitly, since the worker runs as service_role and gets no RLS.

import type { createAdminClient } from "@/lib/supabase/admin";
import {
  MAX_POST_TITLE,
  MAX_POST_CONTENT,
  MAX_FEATURED_IMAGE_CHARS,
  markdownToBlockTree,
  blogRenderCtx,
  renderBlockTree,
  slugify,
} from "@/lib/blog";
import { isValidImageDataUrl } from "@/lib/images/validate";

type AdminClient = ReturnType<typeof createAdminClient>;

// Post slugs are unique per blog (0033). New posts often share a title, so suffix until free
// rather than letting the partial unique index throw.
export async function uniquePostSlug(
  admin: AdminClient,
  workspaceId: string,
  desired: string
): Promise<string> {
  for (let n = 1; n <= 50; n++) {
    const candidate = n === 1 ? desired : `${desired}-${n}`;
    const { data } = await admin
      .from("blog_posts")
      .select("id")
      .eq("workspace_id", workspaceId)
      .ilike("slug", candidate)
      .maybeSingle();
    if (!data) return candidate;
  }
  return `${desired}-${Math.floor(Date.now() / 1000)}`;
}

export type CampaignPostResult =
  | { created: true; postId: string }
  | { created: false; reason: "no_blog_content" | "already_exists"; postId?: string };

// Creates a DRAFT post from a campaign's generated article. Draft is deliberate: this is
// machine-written copy about someone else's product, and publishing it to a public blog without
// the tenant reading it first isn't a call this app should make for them.
//
// Idempotent on campaign_id — a rebuilt campaign updates its own kit rather than accumulating a
// second post each time. (campaign_id is `on delete set null`, so a post whose campaign was
// deleted stops blocking, which is right: the old post is now unrelated history.)
export async function createPostFromCampaign(
  admin: AdminClient,
  workspaceId: string,
  campaignId: string
): Promise<CampaignPostResult> {
  const { data: existing } = await admin
    .from("blog_posts")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("campaign_id", campaignId)
    .maybeSingle();
  if (existing) return { created: false, reason: "already_exists", postId: existing.id as string };

  const { data: campaign } = await admin
    .from("campaigns")
    .select("id, user_id, blog_md, embedded_image_data_url, products(product_title)")
    .eq("id", campaignId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (!campaign?.blog_md) return { created: false, reason: "no_blog_content" };

  const productTitle = (campaign.products as unknown as { product_title: string } | null)?.product_title;
  // First markdown H1 in the generated blog_md is the natural title; fall back to the product.
  const h1 = /^#\s+(.+)$/m.exec(campaign.blog_md as string)?.[1]?.trim();
  const title = (h1 || (productTitle ? `${productTitle} review` : "Untitled post")).slice(0, MAX_POST_TITLE);
  const contentMd = (campaign.blog_md as string).slice(0, MAX_POST_CONTENT);

  // The post inherits the campaign's product shot as its featured image — a sensible default the
  // tenant can replace (upload) or regenerate (AI) from the editor.
  const img = campaign.embedded_image_data_url as string | null;
  const featuredImage = img && isValidImageDataUrl(img, MAX_FEATURED_IMAGE_CHARS) ? img : null;

  const tree = markdownToBlockTree(contentMd, { dropFirstH1: true });
  const html = renderBlockTree(tree, blogRenderCtx());

  const { data, error } = await admin
    .from("blog_posts")
    .insert({
      workspace_id: workspaceId,
      // blog_posts.user_id is NOT NULL, and omitting it made every call to this function throw —
      // silently in the worker (its try/catch swallowed it) and as a 500 from the import button.
      // The post is derived from the campaign, so it inherits the campaign's created-by
      // attribution rather than whoever happened to trigger the import.
      user_id: campaign.user_id as string,
      campaign_id: campaign.id as string,
      title,
      slug: await uniquePostSlug(admin, workspaceId, slugify(title) || "post"),
      content_md: contentMd,
      page_copy: tree,
      html,
      featured_image_url: featuredImage,
      featured_image_status: featuredImage ? "ready" : "none",
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return { created: true, postId: data.id as string };
}
