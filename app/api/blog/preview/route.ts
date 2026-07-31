import { createClient } from "@/lib/supabase/server";
import { renderBlogIndexHtml, type BlogIndexPost } from "@/lib/blog";

export const dynamic = "force-dynamic";

// Owner-only preview of the blog home. The public index (app/b/[...path]) only exists once a blog
// slug is set and only ever shows published posts, so there was no way to see what the home page
// looks like while you're still setting it up — this fills that gap.
//
// Drafts are INCLUDED here on purpose: the point is to see the layout with your actual content.
// Nothing here is reachable without a session, and the response is noindex'd regardless.
const HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "X-Robots-Tag": "noindex, nofollow",
  "Cache-Control": "no-store",
  "Referrer-Policy": "strict-origin-when-cross-origin",
};

export async function GET() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Not signed in", { status: 401 });

  // Every read here is RLS-scoped to the caller, so a preview can only ever show their own blog.
  const [{ data: settings }, { data: rows }, { data: cats }] = await Promise.all([
    supabase
      .from("blog_settings")
      .select("blog_title, slug, description, author_name, author_bio, author_avatar_url, permalink_style, intro_html")
      .maybeSingle(),
    supabase
      .from("blog_posts")
      .select(
        "id, title, slug, excerpt, content_md, html, featured_image_url, published_at, blog_categories(name, slug)"
      )
      .order("published_at", { ascending: false, nullsFirst: true })
      .limit(50),
    supabase.from("blog_categories").select("name, slug, description").order("name"),
  ]);

  const posts: BlogIndexPost[] = (rows ?? []).map((r: any) => ({
    id: r.id,
    title: r.title,
    slug: r.slug,
    excerpt: r.excerpt,
    content_md: r.content_md ?? "",
    html: r.html,
    featured_image_url: r.featured_image_url,
    published_at: r.published_at,
    category_name: r.blog_categories?.name ?? null,
    category_slug: r.blog_categories?.slug ?? null,
  }));

  const html = renderBlogIndexHtml(settings ?? {}, posts, {
    categories: (cats ?? []).map((c: any) => ({
      name: c.name,
      slug: c.slug,
      description: c.description,
    })),
    page: 1,
    totalPages: 1,
  });
  return new Response(html, { status: 200, headers: HEADERS });
}
