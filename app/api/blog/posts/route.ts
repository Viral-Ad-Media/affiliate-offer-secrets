import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { MAX_POST_TITLE, MAX_POST_CONTENT } from "@/lib/blog";

export const dynamic = "force-dynamic";

// Create a draft post — blank, or seeded from one of the caller's own campaigns' blog_md
// (importing copies the markdown; campaigns.blog_md itself is never modified from here).
export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const campaignId = typeof body.campaign_id === "string" ? body.campaign_id : null;

  let title = "Untitled post";
  let content = "";
  let sourceCampaignId: string | null = null;

  if (campaignId) {
    // RLS-scoped read — doubles as the ownership check (another tenant's campaign id reads as
    // nonexistent), same idiom as every other campaign-scoped route.
    const { data: campaign } = await supabase
      .from("campaigns")
      .select("id, blog_md, products(product_title)")
      .eq("id", campaignId)
      .maybeSingle();
    if (!campaign?.blog_md) {
      return NextResponse.json({ error: "campaign not found or has no blog content" }, { status: 404 });
    }
    const productTitle = (campaign.products as unknown as { product_title: string } | null)?.product_title;
    // First markdown H1 in the generated blog_md is the natural title; fall back to the product.
    const h1 = /^#\s+(.+)$/m.exec(campaign.blog_md as string)?.[1]?.trim();
    title = (h1 || (productTitle ? `${productTitle} review` : title)).slice(0, MAX_POST_TITLE);
    content = (campaign.blog_md as string).slice(0, MAX_POST_CONTENT);
    sourceCampaignId = campaign.id as string;
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("blog_posts")
    .insert({ user_id: user.id, campaign_id: sourceCampaignId, title, content_md: content })
    .select("id")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, post_id: data.id });
}
