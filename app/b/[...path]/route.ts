import { createAdminClient } from "@/lib/supabase/admin";
import {
  renderPublicPostHtml,
  renderBlogIndexHtml,
  renderRssXml,
  renderSitemapXml,
  blogPostPath,
  type PermalinkStyle,
} from "@/lib/blog";
import { loadBlogIndex, loadAllPublishedPosts } from "@/lib/blogIndex";
import { publicWorkspaceScope } from "@/lib/publicPage";

// Feeds are cheap to regenerate but change only on publish — a short shared cache keeps crawler
// and reader-app polling off the database without making a new post wait long to appear.
const xmlHeaders = (name: string) => ({
  "Content-Type": name === "rss.xml" ? "application/rss+xml; charset=utf-8" : "application/xml; charset=utf-8",
  "Cache-Control": "public, max-age=300, s-maxage=300",
});

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const HTML_HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "Referrer-Policy": "strict-origin-when-cross-origin",
};

const notFound = () => new Response("Not found", { status: 404 });

// Public blog on the app's own domain:
//   /b/{blogSlug}             → index of that tenant's published posts
//   /b/{blogSlug}/…/{postSlug} → one post; the segments before the slug come from the tenant's
//                                permalink structure (0044) — date or category — and are not used
//                                to find the post: it's resolved by its final slug segment alone.
//                                Anything that isn't the canonical path for the CURRENT structure
//                                301s to it, so changing the structure never breaks a shared link
//                                and search engines consolidate on one address.
//   /b/{postId}               → legacy UUID link, 301s to the canonical slug URL
//
// Access model is unchanged from the original single-post route: published-only scoping is the
// access control and every miss is the same generic 404 (no draft/ownership oracle). Deliberately
// indexable — blog posts are content marketing, unlike funnel pages which send noindex.
// The custom-domain equivalent lives in app/d/[[...path]]/route.ts and shares the same renderers.
export async function GET(req: Request, { params }: { params: { path?: string[] } }) {
  const segments = (params.path ?? []).filter(Boolean);
  // blogSlug + at most a 3-segment permalink (yyyy/mm/slug) — anything longer is not a shape this
  // app can produce.
  if (segments.length === 0 || segments.length > 4) return notFound();
  const admin = createAdminClient();

  // On a workspace subdomain, only that workspace's blog serves — the blog is identified by its
  // own path slug, so without this check acme.{root}/b/{globex-blog} would serve another tenant's
  // blog under acme's branded host. Same shape as lib/publicPage.ts's funnel-page scoping.
  const scope = await publicWorkspaceScope(admin, req.headers.get("host"));
  const rejects = (workspaceId: string | null | undefined) =>
    scope.restricted && (!scope.workspaceId || scope.workspaceId !== workspaceId);

  // Legacy /b/{uuid} — resolve and redirect to the canonical slug URL so previously-shared links
  // keep working and search engines consolidate on one address.
  if (segments.length === 1 && UUID_RE.test(segments[0])) {
    const { data: post } = await admin
      .from("blog_posts")
      .select("id, workspace_id, slug, status")
      .eq("id", segments[0])
      .eq("status", "published")
      .maybeSingle();
    if (!post || rejects(post.workspace_id as string)) return notFound();
    const { data: settings } = await admin
      .from("blog_settings")
      .select("slug")
      .eq("workspace_id", post.workspace_id as string)
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
    .select("workspace_id, blog_title, slug, description, author_name, author_bio, author_avatar_url, permalink_style, intro_html, index_layout, index_columns, index_rows")
    .ilike("slug", segments[0])
    .maybeSingle();
  if (!settings || rejects(settings.workspace_id as string)) return notFound();

  if (segments.length === 1) {
    const index = await loadBlogIndex(
      admin,
      settings.workspace_id as string,
      new URL(req.url).searchParams,
      settings
    );
    // Unknown category slug or a page past the end — 404 rather than silently showing everything.
    if (!index) return notFound();
    return new Response(renderBlogIndexHtml(settings, index.posts, index), {
      status: 200,
      headers: HTML_HEADERS,
    });
  }

  // Feeds live under the blog's own prefix. Safe to reserve these names: slugify() strips dots,
  // so no post slug can ever be "rss.xml" or "sitemap.xml".
  if (segments[1] === "rss.xml" || segments[1] === "sitemap.xml") {
    const posts = await loadAllPublishedPosts(admin, settings.workspace_id as string);
    const origin = process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.url).origin;
    const base = `/b/${settings.slug}`;
    const body =
      segments[1] === "rss.xml"
        ? renderRssXml(settings, posts, origin, base)
        : renderSitemapXml(posts, origin, base, settings.permalink_style as PermalinkStyle | null);
    return new Response(body, { status: 200, headers: xmlHeaders(segments[1]) });
  }

  // The post is keyed off the LAST segment; any date/category segments before it are decoration
  // from whatever structure was in force when the link was made.
  const { data: post } = await admin
    .from("blog_posts")
    .select("id, slug, published_at, blog_categories(slug)")
    .eq("workspace_id", settings.workspace_id as string)
    .ilike("slug", segments[segments.length - 1])
    .eq("status", "published")
    .maybeSingle();
  if (!post) return notFound();

  const canonical = blogPostPath(
    settings.slug as string | null,
    post.slug as string | null,
    post.id as string,
    {
      published_at: post.published_at as string | null,
      category_slug: (post.blog_categories as unknown as { slug: string | null } | null)?.slug ?? null,
    },
    settings.permalink_style as PermalinkStyle | null
  );
  // Compare against the full incoming path — blogPostPath() returns "/b/…", so leaving the /b
  // prefix off here makes every canonical URL redirect to itself forever.
  const requested = `/b/${segments.join("/")}`;
  if (requested !== canonical) {
    return new Response(null, { status: 301, headers: { Location: canonical } });
  }
  return renderPost(admin, post.id as string);
}

async function renderPost(admin: ReturnType<typeof createAdminClient>, postId: string): Promise<Response> {
  const { data: post } = await admin
    .from("blog_posts")
    .select(
      "id, workspace_id, title, slug, content_md, html, excerpt, featured_image_url, published_at, seo_title, seo_description, seo_index, blog_categories(name)"
    )
    .eq("id", postId)
    .eq("status", "published")
    .maybeSingle();
  if (!post) return notFound();

  const { data: settings } = await admin
    .from("blog_settings")
    .select("blog_title, slug, description, author_name, author_bio, author_avatar_url, permalink_style")
    .eq("workspace_id", post.workspace_id as string)
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
