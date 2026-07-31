import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  MAX_POST_TITLE,
  MAX_POST_CONTENT,
  MAX_FEATURED_IMAGE_CHARS,
  markdownToBlockTree,
  emptyPostTree,
  blogRenderCtx,
  renderBlockTree,
  slugify,
} from "@/lib/blog";
import { isValidImageDataUrl } from "@/lib/images/validate";

export const dynamic = "force-dynamic";

// Post slugs are unique per blog (0033). New posts often share a title ("Untitled post"), so
// suffix until free rather than letting the partial unique index throw.
async function uniqueSlug(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  desired: string
): Promise<string> {
  for (let n = 1; n <= 50; n++) {
    const candidate = n === 1 ? desired : `${desired}-${n}`;
    const { data } = await admin
      .from("blog_posts")
      .select("id")
      .eq("user_id", userId)
      .ilike("slug", candidate)
      .maybeSingle();
    if (!data) return candidate;
  }
  return `${desired}-${Math.floor(Date.now() / 1000)}`;
}

// Create a draft post — blank, or seeded from one of the caller's own campaigns' blog_md
// (importing converts the markdown into a pageKind-"blog" block tree; campaigns.blog_md itself
// is never modified from here). page_copy + a write-time html render are stored from the start,
// so every new post is immediately editable in the WysiwygCanvas editor.
export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const campaignId = typeof body.campaign_id === "string" ? body.campaign_id : null;

  let title = "Untitled post";
  let contentMd = "";
  let sourceCampaignId: string | null = null;
  // Imported posts inherit the campaign's product shot as their featured image — a sensible
  // default the tenant can replace (upload) or regenerate (AI) from the editor.
  let featuredImage: string | null = null;

  if (campaignId) {
    // RLS-scoped read — doubles as the ownership check (another tenant's campaign id reads as
    // nonexistent), same idiom as every other campaign-scoped route.
    const { data: campaign } = await supabase
      .from("campaigns")
      .select("id, blog_md, embedded_image_data_url, products(product_title)")
      .eq("id", campaignId)
      .maybeSingle();
    if (!campaign?.blog_md) {
      return NextResponse.json({ error: "campaign not found or has no blog content" }, { status: 404 });
    }
    const productTitle = (campaign.products as unknown as { product_title: string } | null)?.product_title;
    // First markdown H1 in the generated blog_md is the natural title; fall back to the product.
    const h1 = /^#\s+(.+)$/m.exec(campaign.blog_md as string)?.[1]?.trim();
    title = (h1 || (productTitle ? `${productTitle} review` : title)).slice(0, MAX_POST_TITLE);
    contentMd = (campaign.blog_md as string).slice(0, MAX_POST_CONTENT);
    sourceCampaignId = campaign.id as string;
    const img = campaign.embedded_image_data_url as string | null;
    if (img && isValidImageDataUrl(img, MAX_FEATURED_IMAGE_CHARS)) featuredImage = img;
  }

  const tree = contentMd ? markdownToBlockTree(contentMd, { dropFirstH1: true }) : emptyPostTree();
  const html = renderBlockTree(tree, blogRenderCtx());

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("blog_posts")
    .insert({
      user_id: user.id,
      campaign_id: sourceCampaignId,
      title,
      slug: await uniqueSlug(admin, user.id, slugify(title) || "post"),
      content_md: contentMd,
      page_copy: tree,
      html,
      featured_image_url: featuredImage,
      featured_image_status: featuredImage ? "ready" : "none",
    })
    .select("id")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, post_id: data.id });
}
