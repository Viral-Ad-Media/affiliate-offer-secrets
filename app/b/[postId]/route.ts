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
    .select("title, content_md, published_at, blog_categories(name)")
    .eq("id", params.postId)
    .eq("status", "published")
    .maybeSingle();

  if (!post) return new Response("Not found", { status: 404 });

  const html = renderPublicPostHtml({
    title: post.title as string,
    content_md: post.content_md as string,
    published_at: post.published_at as string | null,
    category_name: (post.blog_categories as unknown as { name: string } | null)?.name ?? null,
  });

  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Referrer-Policy": "strict-origin-when-cross-origin",
    },
  });
}
