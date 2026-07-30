import { createAdminClient } from "@/lib/supabase/admin";
import { renderPublicPostHtml } from "@/lib/blog";

export const dynamic = "force-dynamic";

// Public blog post page. Same access model as /p/[campaignId]: the post UUID is unguessable and
// the query is scoped to status='published' — drafts and other tenants' ids are the same generic
// 404 (no state oracle). Unlike funnel pages there's no noindex header: blog posts are content
// marketing and SHOULD be crawlable. Content passes through lib/blog.ts's render-time HTML
// escaping — see that file for why that's the security boundary here.
export async function GET(_req: Request, { params }: { params: { postId: string } }) {
  const admin = createAdminClient();
  const { data: post } = await admin
    .from("blog_posts")
    .select("user_id, title, content_md, html, published_at, seo_title, seo_description, seo_index, blog_categories(name)")
    .eq("id", params.postId)
    .eq("status", "published")
    .maybeSingle();

  if (!post) return new Response("Not found", { status: 404 });

  const { data: settings } = await admin
    .from("blog_settings")
    .select("blog_title, author_name")
    .eq("user_id", post.user_id as string)
    .maybeSingle();

  const html = renderPublicPostHtml({
    id: params.postId,
    title: post.title as string,
    content_md: post.content_md as string,
    html: post.html as string | null,
    published_at: post.published_at as string | null,
    category_name: (post.blog_categories as unknown as { name: string } | null)?.name ?? null,
    settings: settings ?? null,
    seo_title: post.seo_title as string | null,
    seo_description: post.seo_description as string | null,
    seo_index: post.seo_index as boolean,
  });

  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Referrer-Policy": "strict-origin-when-cross-origin",
    },
  });
}
