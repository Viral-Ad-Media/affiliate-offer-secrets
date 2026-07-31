import { createAdminClient } from "@/lib/supabase/admin";
import { servePublicCampaignPage } from "@/lib/publicPage";
import { renderPublicPostHtml, renderBlogIndexHtml, renderRssXml, renderSitemapXml } from "@/lib/blog";
import { loadBlogIndex, loadAllPublishedPosts } from "@/lib/blogIndex";

const HTML_HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "Referrer-Policy": "strict-origin-when-cross-origin",
};

const xmlHeaders = (name: string) => ({
  "Content-Type": name === "rss.xml" ? "application/rss+xml; charset=utf-8" : "application/xml; charset=utf-8",
  "Cache-Control": "public, max-age=300, s-maxage=300",
});

// Serves the domain owner's blog at the domain root. Returns null (not a 404) when nothing
// matches so the caller can fall through to its own generic 404 — keeps one not-found shape.
async function serveBlogOnDomain(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  path: string,
  siteOrigin: string,
  searchParams: URLSearchParams
): Promise<Response | null> {
  const { data: settings } = await admin
    .from("blog_settings")
    .select("blog_title, slug, description, author_name, author_bio, author_avatar_url")
    .eq("user_id", userId)
    .maybeSingle();
  if (!settings) return null;

  if (path === "") {
    const index = await loadBlogIndex(admin, userId, searchParams);
    if (!index) return null; // unknown category / page past the end → caller's generic 404
    return new Response(renderBlogIndexHtml(settings, index.posts, { ...index, siteOrigin }), {
      status: 200,
      headers: HTML_HEADERS,
    });
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
    const posts = await loadAllPublishedPosts(admin, userId);
    const body =
      path === "rss.xml" ? renderRssXml(settings, posts, siteOrigin, "") : renderSitemapXml(posts, siteOrigin, "");
    return new Response(body, { status: 200, headers: xmlHeaders(path) });
  }

  const { data: post } = await admin
    .from("blog_posts")
    .select(
      "id, title, slug, content_md, html, excerpt, featured_image_url, published_at, seo_title, seo_description, seo_index, blog_categories(name)"
    )
    .eq("user_id", userId)
    .ilike("slug", path)
    .eq("status", "published")
    .maybeSingle();
  if (!post) return null;

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
    settings,
    seo_title: post.seo_title as string | null,
    seo_description: post.seo_description as string | null,
    seo_index: post.seo_index as boolean,
    siteOrigin,
  });
  return new Response(html, { status: 200, headers: HTML_HEADERS });
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
    .select("id, user_id, serves_blog")
    .eq("domain", host)
    .eq("status", "verified")
    .maybeSingle();
  if (!domainRow) return new Response("Not found", { status: 404 });

  const { data: routeRow } = await admin
    .from("custom_domain_routes")
    .select("campaign_id")
    .eq("domain_id", domainRow.id)
    .eq("path", path)
    .maybeSingle();
  if (routeRow) return servePublicCampaignPage(routeRow.campaign_id, request);

  // Blog fallback (0033): explicit funnel routes above always win, so a domain can host mapped
  // funnel pages AND serve the owner's blog on every other path — "" is the index, anything else
  // is treated as a post slug.
  if (domainRow.serves_blog) {
    const blog = await serveBlogOnDomain(
      admin,
      domainRow.user_id as string,
      path,
      `https://${host}`,
      new URL(request.url).searchParams
    );
    if (blog) return blog;
  }

  return new Response("Not found", { status: 404 });
}
