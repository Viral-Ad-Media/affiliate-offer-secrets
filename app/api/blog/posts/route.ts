import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { emptyPostTree, blogRenderCtx, renderBlockTree } from "@/lib/blog";
import { createPostFromCampaign, uniquePostSlug } from "@/lib/blog/fromCampaign";

export const dynamic = "force-dynamic";

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

  const { data: ws } = await supabase.rpc("current_workspace_id");

  const body = await req.json().catch(() => ({}));
  const campaignId = typeof body.campaign_id === "string" ? body.campaign_id : null;
  const admin = createAdminClient();

  // Importing shares one implementation with the engine's auto-create (lib/blog/fromCampaign.ts)
  // so a hand-imported post and an auto-created one can't diverge. Ownership is enforced by the
  // helper scoping every read to this user_id — another tenant's campaign id reads as nonexistent.
  if (campaignId) {
    const result = await createPostFromCampaign(admin, ws as string, campaignId);
    if (!result.created && result.reason === "no_blog_content") {
      return NextResponse.json({ error: "campaign not found or has no blog content" }, { status: 404 });
    }
    // An existing post for this campaign is returned rather than duplicated — the engine may have
    // already created it when the kit finished building.
    return NextResponse.json({ ok: true, post_id: result.postId, existing: !result.created });
  }

  const tree = emptyPostTree();
  const html = renderBlockTree(tree, blogRenderCtx());
  const { data, error } = await admin
    .from("blog_posts")
    .insert({
      user_id: user.id,
      title: "Untitled post",
      slug: await uniquePostSlug(admin, ws as string, "post"),
      content_md: "",
      page_copy: tree,
      html,
      featured_image_status: "none",
    })
    .select("id")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, post_id: data.id });
}
