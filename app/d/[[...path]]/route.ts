import { contentWidthOf } from "@/lib/engine/renderPages";
import { publicNotFound } from "@/lib/notFoundPage";
import { createAdminClient } from "@/lib/supabase/admin";
import { servePublicCampaignPage } from "@/lib/publicPage";
import {
  renderPublicPostHtml,
  renderBlogIndexHtml,
  renderRssXml,
  renderSitemapXml,
  blogPostPathOnDomain,
  type PermalinkStyle,
} from "@/lib/blog";
import { loadBlogIndex, loadAllPublishedPosts } from "@/lib/blogIndex";

const HTML_HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "Referrer-Policy": "strict-origin-when-cross-origin",
};

const xmlHeaders = (name: string) => ({
  "Content-Type": name === "rss.xml" ? "application/rss+xml; charset=utf-8" : "application/xml; charset=utf-8",
  "Cache-Control": "public, max-age=300, s-maxage=300",
});

/**
 * The post-page render, shared by the post branch and the static-home root (0108).
 *
 * NOTE: the first extraction of this helper accidentally replaced its own body with a call to
 * itself — infinite recursion on every custom-domain post view, shipped because the live check
 * only exercised /b. The /d assertions in scratchpad verify-comments now exist because of it.
 */
async function renderDomainPost(
  admin: ReturnType<typeof createAdminClient>,
  post: any,
  settings: any,
  siteOrigin: string,
  commentPosted = false
): Promise<Response> {
  // Approved only — the moderation boundary's read half, same as /b's renderPost.
  const { data: comments } = settings?.comments_enabled
    ? await admin
        .from("blog_comments")
        .select("author_name, body, rating, created_at")
        .eq("post_id", post.id)
        .eq("status", "approved")
        .order("created_at", { ascending: true })
        .limit(200)
    : { data: [] };
  const html = renderPublicPostHtml({
    comments: (comments ?? []) as { author_name: string; body: string; rating: number | null; created_at: string }[],
    comments_enabled: settings?.comments_enabled === true,
    ratings_enabled: settings?.ratings_enabled === true,
    comment_posted: commentPosted,
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
    settings,
    seo_title: post.seo_title as string | null,
    seo_description: post.seo_description as string | null,
    seo_index: post.seo_index as boolean,
    siteOrigin,
  });
  return new Response(html, { status: 200, headers: HTML_HEADERS });
}

// Serves the domain owner's blog at the domain root. Returns null (not a 404) when nothing
// matches so the caller can fall through to its own generic 404 — keeps one not-found shape.
async function serveBlogOnDomain(
  admin: ReturnType<typeof createAdminClient>,
  workspaceId: string,
  path: string,
  siteOrigin: string,
  searchParams: URLSearchParams
): Promise<Response | null> {
  const { data: settings } = await admin
    .from("blog_settings")
    .select("blog_title, slug, description, author_name, author_bio, author_avatar_url, permalink_style, intro_html, index_layout, index_columns, index_rows, toc_enabled, toc_title, toc_min_headings, home_post_id, comments_enabled, ratings_enabled")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (!settings) return null;

  // Static home (0108): the chosen PUBLISHED page serves at the root, the list at /posts. A draft
  // or deleted home degrades back to the list — never a 404 at a domain's root.
  const homePostId = (settings as { home_post_id?: string | null }).home_post_id ?? null;
  const serveIndex = async (listBase?: string) => {
    const index = await loadBlogIndex(admin, workspaceId, searchParams, settings);
    if (!index) return null; // unknown category / page past the end → caller's generic 404
    return new Response(renderBlogIndexHtml(settings, index.posts, { ...index, siteOrigin, listBase }), {
      status: 200,
      headers: HTML_HEADERS,
    });
  };

  if (path === "") {
    if (homePostId) {
      const { data: home } = await admin
        .from("blog_posts")
        .select("id, title, slug, content_md, html, page_copy, excerpt, featured_image_url, published_at, seo_title, seo_description, seo_index, blog_categories(name, slug)")
        .eq("id", homePostId)
        .eq("workspace_id", workspaceId)
        .eq("status", "published")
        .maybeSingle();
      // Rendered IN PLACE, never routed through the post branch: that branch 301s to the post's
      // canonical URL, which under a dated permalink style would bounce the DOMAIN ROOT away to
      // /2026/08/{slug} — a static home that redirects off the root is not a home.
      if (home) return renderDomainPost(admin, home, settings, siteOrigin, searchParams.get("commented") === "1");
    }
    return serveIndex();
  }

  if (path === "posts" && homePostId) {
    return serveIndex("/posts");
  }

  // On a custom domain the blog is the site root, so its feeds sit at the root too. Reserving
  // these names is safe: slugify() strips dots, so no post slug can collide with them.
  if (path === "rss.xml" || path === "sitemap.xml" || path === "robots.txt") {
    if (path === "robots.txt") {
      // The app-wide app/robots.ts only answers for the app's own host — a connected domain needs
      // its own, pointing crawlers at this blog's sitemap.
      return new Response(`User-agent: *\nAllow: /\n\nSitemap: ${siteOrigin}/sitemap.xml\n`, {
        status: 200,
        headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" },
      });
    }
    const posts = await loadAllPublishedPosts(admin, workspaceId);
    const body =
      path === "rss.xml"
        ? renderRssXml(settings, posts, siteOrigin, "")
        : renderSitemapXml(posts, siteOrigin, "", settings.permalink_style as PermalinkStyle | null);
    return new Response(body, { status: 200, headers: xmlHeaders(path) });
  }

  // Resolved by the LAST path segment: the segments before it come from the tenant's permalink
  // structure (0044) and are decoration, so a link made under an older structure still finds its
  // post — and gets 301'd to the current canonical path below.
  const segments = path.split("/").filter(Boolean);
  const { data: post } = await admin
    .from("blog_posts")
    .select(
      "id, title, slug, content_md, html, page_copy, excerpt, featured_image_url, published_at, seo_title, seo_description, seo_index, blog_categories(name, slug)"
    )
    .eq("workspace_id", workspaceId)
    .ilike("slug", segments[segments.length - 1] ?? path)
    .eq("status", "published")
    .maybeSingle();
  if (!post) return null;

  const canonical = blogPostPathOnDomain(
    {
      slug: post.slug as string | null,
      id: post.id as string,
      published_at: post.published_at as string | null,
      category_slug: (post.blog_categories as unknown as { slug: string | null } | null)?.slug ?? null,
    },
    settings.permalink_style as PermalinkStyle | null
  );
  if (`/${path}` !== canonical) {
    return new Response(null, { status: 301, headers: { Location: canonical } });
  }

  return renderDomainPost(admin, post, settings, siteOrigin, searchParams.get("commented") === "1");
}

// Catch-all target for the middleware's host-mismatch rewrite (middleware.ts) — serves a
// campaign's bridge (lead-capture landing) page under a tenant's own connected custom domain.
// Reads the Host header directly (NOT request's URL, which reflects the rewritten internal path,
// not the original incoming domain — see middleware.ts's comment for why this distinction
// matters). Same generic 404 for "domain not verified" and "no route mapped" as the existing /p/
// route (lib/publicPage.ts) — no status oracle.
export async function GET(request: Request, { params }: { params: { path?: string[] } }) {
  const host = request.headers.get("host") ?? "";
  const path = (params.path ?? []).join("/");

  const admin = createAdminClient();

  const { data: domainRow } = await admin
    .from("custom_domains")
    .select("id, workspace_id, serves_blog")
    .eq("domain", host)
    .eq("status", "verified")
    .maybeSingle();
  if (!domainRow) return publicNotFound(host);

  const { data: routeRow } = await admin
    .from("custom_domain_routes")
    .select("campaign_id")
    .eq("domain_id", domainRow.id)
    .eq("workspace_id", domainRow.workspace_id)
    .eq("path", path)
    .maybeSingle();
  if (routeRow) {
    return servePublicCampaignPage(routeRow.campaign_id, request, domainRow.workspace_id);
  }

  // Blog fallback (0033): explicit funnel routes above always win, so a domain can host mapped
  // funnel pages AND serve the owner's blog on every other path — "" is the index, anything else
  // is treated as a post slug.
  if (domainRow.serves_blog) {
    const blog = await serveBlogOnDomain(
      admin,
      domainRow.workspace_id as string,
      path,
      `https://${host}`,
      new URL(request.url).searchParams
    );
    if (blog) return blog;
  }

  return publicNotFound(host);
}
