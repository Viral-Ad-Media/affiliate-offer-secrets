import { createAdminClient } from "@/lib/supabase/admin";
import { renderPublicPostHtml, renderBlogIndexHtml, blogPostPath } from "@/lib/blog";
import { loadBlogIndex } from "@/lib/blogIndex";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const HTML_HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "Referrer-Policy": "strict-origin-when-cross-origin",
};

const notFound = () => new Response("Not found", { status: 404 });

// Public blog on the app's own domain:
//   /b/{blogSlug}             → index of that tenant's published posts
//   /b/{blogSlug}/{postSlug}  → one post
//   /b/{postId}               → legacy UUID link, 301s to the canonical slug URL
//
// Access model is unchanged from the original single-post route: published-only scoping is the
// access control and every miss is the same generic 404 (no draft/ownership oracle). Deliberately
// indexable — blog posts are content marketing, unlike funnel pages which send noindex.
// The custom-domain equivalent lives in app/d/[[...path]]/route.ts and shares the same renderers.
export async function GET(req: Request, { params }: { params: { path?: string[] } }) {
  const segments = (params.path ?? []).filter(Boolean);
  if (segments.length === 0 || segments.length > 2) return notFound();
  const admin = createAdminClient();

  // Legacy /b/{uuid} — resolve and redirect to the canonical slug URL so previously-shared links
  // keep working and search engines consolidate on one address.
  if (segments.length === 1 && UUID_RE.test(segments[0])) {
    const { data: post } = await admin
      .from("blog_posts")
      .select("id, user_id, slug, status")
      .eq("id", segments[0])
      .eq("status", "published")
      .maybeSingle();
    if (!post) return notFound();
    const { data: settings } = await admin
      .from("blog_settings")
      .select("slug")
      .eq("user_id", post.user_id as string)
      .maybeSingle();
    const target = blogPostPath(settings?.slug ?? null, post.slug as string | null, post.id as string);
    // Only redirect if we actually have a nicer URL; otherwise render in place below.
    if (target !== `/b/${post.id}`) {
      return new Response(null, { status: 301, headers: { Location: target } });
    }
    return renderPost(admin, post.id as string);
  }

  // Everything else is keyed off the blog slug.
  const { data: settings } = await admin
    .from("blog_settings")
    .select("user_id, blog_title, slug, description, author_name, author_bio, author_avatar_url")
    .ilike("slug", segments[0])
    .maybeSingle();
  if (!settings) return notFound();

  if (segments.length === 1) {
    const index = await loadBlogIndex(admin, settings.user_id as string, new URL(req.url).searchParams);
    // Unknown category slug or a page past the end — 404 rather than silently showing everything.
    if (!index) return notFound();
    return new Response(renderBlogIndexHtml(settings, index.posts, index), {
      status: 200,
      headers: HTML_HEADERS,
    });
  }

  // /b/{blogSlug}/{postSlug}
  const { data: post } = await admin
    .from("blog_posts")
    .select("id")
    .eq("user_id", settings.user_id as string)
    .ilike("slug", segments[1])
    .eq("status", "published")
    .maybeSingle();
  if (!post) return notFound();
  return renderPost(admin, post.id as string);
}

async function renderPost(admin: ReturnType<typeof createAdminClient>, postId: string): Promise<Response> {
  const { data: post } = await admin
    .from("blog_posts")
    .select(
      "id, user_id, title, slug, content_md, html, excerpt, featured_image_url, published_at, seo_title, seo_description, seo_index, blog_categories(name)"
    )
    .eq("id", postId)
    .eq("status", "published")
    .maybeSingle();
  if (!post) return notFound();

  const { data: settings } = await admin
    .from("blog_settings")
    .select("blog_title, slug, description, author_name, author_bio, author_avatar_url")
    .eq("user_id", post.user_id as string)
    .maybeSingle();

  const html = renderPublicPostHtml({
    id: post.id as string,
    title: post.title as string,
    slug: post.slug as string | null,
    content_md: (post.content_md as string) ?? "",
    html: post.html as string | null,
    excerpt: post.excerpt as string | null,
    featured_image_url: post.featured_image_url as string | null,
    published_at: post.published_at as string | null,
    category_name: (post.blog_categories as unknown as { name: string } | null)?.name ?? null,
    settings: settings ?? null,
    seo_title: post.seo_title as string | null,
    seo_description: post.seo_description as string | null,
    seo_index: post.seo_index as boolean,
  });
  return new Response(html, { status: 200, headers: HTML_HEADERS });
}
