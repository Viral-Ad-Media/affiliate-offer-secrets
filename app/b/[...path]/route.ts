import { contentWidthOf } from "@/lib/engine/renderPages";
import { publicNotFound } from "@/lib/notFoundPage";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  renderPublicPostHtml,
  renderBlogIndexHtml,
  renderRssXml,
  blogPostPath,
  type PermalinkStyle,
} from "@/lib/blog";
import { loadBlogIndex, loadAllPublishedPosts, buildBlogSitemap, isSitemapPath } from "@/lib/blogIndex";
import { publicWorkspaceScope } from "@/lib/publicPage";
import { PUBLIC_CONTENT_CSP } from "@/lib/csp";

// Feeds are cheap to regenerate but change only on publish — a short shared cache keeps crawler
// and reader-app polling off the database without making a new post wait long to appear.
const xmlHeaders = (name: string) => ({
  "Content-Type": name === "rss.xml" ? "application/rss+xml; charset=utf-8" : "application/xml; charset=utf-8",
  "Cache-Control": "public, max-age=300, s-maxage=300",
});

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Same reasoning as the feeds above, now applied to the pages themselves: a published post is
// identical bytes for every reader — no cookie, no per-visitor state, nothing host-dependent past
// the workspace scoping that already resolved before this is used. Every request was reaching the
// function and re-rendering from the database, which is the one thing a blog page never needs.
//
// `max-age=0` keeps the BROWSER revalidating, so an author reloading after an edit sees it at
// once; `s-maxage` is what actually collapses crawler and reader traffic at the CDN.
//
// The tradeoff, stated because it changes a property this codebase verified explicitly:
// unpublishing a post no longer 404s its URL and drops it from the index *instantly*, but within
// roughly a minute (up to ~2 with the revalidate window). That is the standard trade for public
// content and matches what the feeds have always done — but it means unpublish is not an
// immediate kill switch. Keep these numbers small for that reason.
const HTML_HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Cache-Control": "public, max-age=0, s-maxage=60, stale-while-revalidate=60",
  "Content-Security-Policy": PUBLIC_CONTENT_CSP,
};

// Bound per request inside the handler below, because the page it serves depends on the host:
// the blog also serves on tenants' own domains (custom_domains.serves_blog), where our brand
// has no business appearing. See lib/notFoundPage.ts.

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
  const notFound = () => publicNotFound(req.headers.get("host"));
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
    return renderPost(admin, post.id as string, req.headers.get("host"), new URL(req.url).searchParams.get("commented") === "1");
  }

  // Everything else is keyed off the blog slug.
  const { data: settings } = await admin
    .from("blog_settings")
    .select("workspace_id, blog_title, slug, description, author_name, author_bio, author_avatar_url, permalink_style, intro_html, index_layout, index_columns, index_rows, toc_enabled, toc_title, toc_min_headings, home_post_id, tracking")
    .ilike("slug", segments[0])
    .maybeSingle();
  if (!settings || rejects(settings.workspace_id as string)) return notFound();

  // With a static home configured (0108), the chosen page serves at the root and the list moves
  // to /posts. PUBLISHED only: a draft home falls back to the list rather than 404ing the whole
  // blog the moment someone unpublishes the page to edit it — same degrade direction as the FK's
  // on-delete-set-null.
  const homePostId = (settings as { home_post_id?: string | null }).home_post_id ?? null;
  const serveIndex = async (listBase?: string) => {
    const index = await loadBlogIndex(
      admin,
      settings.workspace_id as string,
      new URL(req.url).searchParams,
      settings
    );
    // Unknown category slug or a page past the end — 404 rather than silently showing everything.
    if (!index) return notFound();
    return new Response(renderBlogIndexHtml(settings, index.posts, { ...index, listBase }), {
      status: 200,
      headers: HTML_HEADERS,
    });
  };

  if (segments.length === 1) {
    if (homePostId) {
      const { data: home } = await admin
        .from("blog_posts")
        .select("id")
        .eq("id", homePostId)
        .eq("workspace_id", settings.workspace_id as string)
        .eq("status", "published")
        .maybeSingle();
      if (home) return renderPost(admin, home.id as string, req.headers.get("host"));
    }
    return serveIndex();
  }

  // The list's home under a static front page. Only answered when one is configured — otherwise
  // /posts stays an ordinary (unreachable) post slug and the root remains the single canonical
  // list URL. Post slugs can no longer BE "posts" (reserved at every slug write), so this name
  // can't shadow anyone's article.
  if (segments.length === 2 && segments[1] === "posts" && homePostId) {
    return serveIndex(`/b/${settings.slug}/posts`);
  }

  // Feeds live under the blog's own prefix. Safe to reserve these names: slugify() strips dots,
  // so no post slug can ever be "rss.xml" or "sitemap.xml".
  if (segments.length === 2 && (segments[1] === "rss.xml" || isSitemapPath(segments[1]))) {
    const origin = process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.url).origin;
    const base = `/b/${settings.slug}`;
    const ws = settings.workspace_id as string;
    const style = settings.permalink_style as PermalinkStyle | null;
    if (segments[1] === "rss.xml") {
      const posts = await loadAllPublishedPosts(admin, ws);
      return new Response(renderRssXml(settings, posts, origin, base), { status: 200, headers: xmlHeaders("rss.xml") });
    }
    const body = await buildBlogSitemap(admin, ws, origin, base, segments[1], style);
    if (body === null) return notFound(); // sitemap-N.xml past the last page
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
  return renderPost(admin, post.id as string, req.headers.get("host"), new URL(req.url).searchParams.get("commented") === "1");
}

async function renderPost(
  admin: ReturnType<typeof createAdminClient>,
  postId: string,
  host: string | null,
  commentPosted = false
): Promise<Response> {
  const { data: post } = await admin
    .from("blog_posts")
    .select(
      "id, workspace_id, title, slug, content_md, html, page_copy, excerpt, featured_image_url, published_at, seo_title, seo_description, seo_index, blog_categories(name)"
    )
    .eq("id", postId)
    .eq("status", "published")
    .maybeSingle();
  if (!post) return publicNotFound(host);

  const { data: settings } = await admin
    .from("blog_settings")
    .select("blog_title, slug, description, author_name, author_bio, author_avatar_url, permalink_style, toc_enabled, toc_title, toc_min_headings, comments_enabled, ratings_enabled, tracking")
    .eq("workspace_id", post.workspace_id as string)
    .maybeSingle();

  // APPROVED only, and the filter lives here — the renderer prints whatever it is handed, so this
  // query is the moderation boundary's read half. Capped: a comment section past 200 entries is a
  // page-weight problem before it is anything else.
  const { data: comments } = settings?.comments_enabled
    ? await admin
        .from("blog_comments")
        .select("author_name, body, rating, created_at")
        .eq("post_id", postId)
        .eq("status", "approved")
        .order("created_at", { ascending: true })
        .limit(200)
    : { data: [] };

  const html = renderPublicPostHtml({
    content_width: contentWidthOf(post.page_copy),
    theme: (post.page_copy as { theme?: unknown } | null)?.theme,
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
    comments: (comments ?? []) as { author_name: string; body: string; rating: number | null; created_at: string }[],
    comments_enabled: settings?.comments_enabled === true,
    ratings_enabled: settings?.ratings_enabled === true,
    comment_posted: commentPosted,
  });
  return new Response(html, { status: 200, headers: HTML_HEADERS });
}
