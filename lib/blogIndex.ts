import type { createAdminClient } from "@/lib/supabase/admin";
import {
  postsPerPage,
  MAX_FEED_POSTS,
  SITEMAP_PAGE_SIZE,
  renderSitemapXml,
  renderSitemapIndexXml,
  type BlogIndexPost,
  type BlogIndexCategory,
  type BlogSettings,
  type PermalinkStyle,
} from "@/lib/blog";

const POST_COLUMNS =
  "id, title, slug, excerpt, content_md, html, featured_image_url, published_at, blog_categories(name, slug)";

function toIndexPost(r: any): BlogIndexPost {
  return {
    id: r.id as string,
    title: r.title as string,
    slug: r.slug as string | null,
    excerpt: r.excerpt as string | null,
    content_md: (r.content_md as string) ?? "",
    html: r.html as string | null,
    featured_image_url: r.featured_image_url as string | null,
    published_at: r.published_at as string | null,
    category_name: (r.blog_categories as { name: string; slug: string | null } | null)?.name ?? null,
    // Needed by the "category-post" permalink structure (0044).
    category_slug: (r.blog_categories as { name: string; slug: string | null } | null)?.slug ?? null,
  };
}

// Every published post, newest first — the feed views (RSS, sitemap) are unpaginated and
// unfiltered by design, so they share this rather than loadBlogIndex's paged query.
export async function loadAllPublishedPosts(
  admin: ReturnType<typeof createAdminClient>,
  workspaceId: string
): Promise<BlogIndexPost[]> {
  const { data } = await admin
    .from("blog_posts")
    .select(POST_COLUMNS)
    .eq("workspace_id", workspaceId)
    .eq("status", "published")
    .order("published_at", { ascending: false, nullsFirst: false })
    .limit(MAX_FEED_POSTS);
  return (data ?? []).map(toIndexPost);
}

// --- Sitemap pagination (unlike RSS, the sitemap must cover EVERY post at any scale) ---

async function countPublishedPosts(
  admin: ReturnType<typeof createAdminClient>,
  workspaceId: string
): Promise<number> {
  const { count } = await admin
    .from("blog_posts")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .eq("status", "published");
  return count ?? 0;
}

async function loadPublishedPostsPage(
  admin: ReturnType<typeof createAdminClient>,
  workspaceId: string,
  offset: number,
  limit: number
): Promise<BlogIndexPost[]> {
  const { data } = await admin
    .from("blog_posts")
    .select(POST_COLUMNS)
    .eq("workspace_id", workspaceId)
    .eq("status", "published")
    .order("published_at", { ascending: false, nullsFirst: false })
    .range(offset, offset + limit - 1);
  return (data ?? []).map(toIndexPost);
}

/**
 * Builds the XML for any sitemap path a blog serves, shared by the app-domain and custom-domain
 * routes so the two can't drift (the standing rule for everything these routes both render).
 *
 * - `sitemap.xml` with <= one page of posts → a plain <urlset> (unchanged from before this existed)
 * - `sitemap.xml` with more → a <sitemapindex> pointing at sitemap-1.xml … sitemap-N.xml
 * - `sitemap-{n}.xml` → the <urlset> for page n (posts only; the blog index url rides on page 1)
 *
 * Returns null for an out-of-range page or a non-sitemap path, which the caller turns into a 404 —
 * so sitemap-999.xml on a small blog is a clean not-found, never an empty file that looks valid.
 */
export async function buildBlogSitemap(
  admin: ReturnType<typeof createAdminClient>,
  workspaceId: string,
  origin: string,
  base: string,
  sitemapPath: string,
  style: PermalinkStyle | null
): Promise<string | null> {
  const total = await countPublishedPosts(admin, workspaceId);
  const pages = Math.max(1, Math.ceil(total / SITEMAP_PAGE_SIZE));

  if (sitemapPath === "sitemap.xml") {
    if (pages <= 1) {
      const posts = await loadPublishedPostsPage(admin, workspaceId, 0, SITEMAP_PAGE_SIZE);
      return renderSitemapXml(posts, origin, base, style, true);
    }
    return renderSitemapIndexXml(origin, base, pages);
  }

  const m = /^sitemap-(\d+)\.xml$/.exec(sitemapPath);
  if (m) {
    const n = Number(m[1]);
    if (!Number.isInteger(n) || n < 1 || n > pages) return null;
    const posts = await loadPublishedPostsPage(admin, workspaceId, (n - 1) * SITEMAP_PAGE_SIZE, SITEMAP_PAGE_SIZE);
    return renderSitemapXml(posts, origin, base, style, n === 1);
  }

  return null;
}

/** Does this path look like a sitemap (index or a numbered page)? Cheap pre-check for the routes. */
export function isSitemapPath(path: string): boolean {
  return path === "sitemap.xml" || /^sitemap-\d+\.xml$/.test(path);
}

export type BlogIndexData = {
  posts: BlogIndexPost[];
  categories: BlogIndexCategory[];
  activeCategory: BlogIndexCategory | null;
  page: number;
  totalPages: number;
};

// Shared by both index call sites — app/b/[...path]/route.ts (app domain) and
// app/d/[[...path]]/route.ts (custom domain) — so the filter/pagination behaviour can't drift
// between them. Returns null only when the requested category slug doesn't exist for this blog,
// which the callers turn into a 404 (rather than silently showing everything, which would make a
// typo'd filter look like it worked).
export async function loadBlogIndex(
  admin: ReturnType<typeof createAdminClient>,
  workspaceId: string,
  params: URLSearchParams,
  // The page size is the tenant's chosen columns x rows, so paging can't disagree with the shape
  // the index actually renders. Omitted (no settings row yet) falls back to the default grid.
  settings?: BlogSettings
): Promise<BlogIndexData | null> {
  const perPage = postsPerPage(settings ?? {});
  const categorySlug = (params.get("category") || "").trim() || null;
  const requestedPage = Number.parseInt(params.get("page") || "1", 10);
  const page = Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1;

  // Only categories that actually contain a published post — an empty chip that leads to "no
  // posts" is a dead end for a reader.
  const { data: catRows } = await admin
    .from("blog_categories")
    .select("id, name, slug, description, blog_posts!inner(id)")
    .eq("workspace_id", workspaceId)
    .eq("blog_posts.status", "published")
    .order("name");

  const seen = new Set<string>();
  const categories: (BlogIndexCategory & { id: string })[] = [];
  for (const c of catRows ?? []) {
    if (seen.has(c.id as string)) continue;
    seen.add(c.id as string);
    categories.push({
      id: c.id as string,
      name: c.name as string,
      slug: c.slug as string | null,
      description: (c.description as string | null) ?? null,
    });
  }

  let activeCategory: (BlogIndexCategory & { id: string }) | null = null;
  if (categorySlug) {
    activeCategory = categories.find((c) => (c.slug ?? "").toLowerCase() === categorySlug.toLowerCase()) ?? null;
    if (!activeCategory) return null;
  }

  const applyFilters = <T extends { eq: (col: string, val: unknown) => T }>(q: T): T => {
    let out = q.eq("workspace_id", workspaceId).eq("status", "published");
    if (activeCategory) out = out.eq("category_id", activeCategory.id);
    return out;
  };

  const { count } = await applyFilters(
    admin.from("blog_posts").select("id", { count: "exact", head: true }) as any
  );
  const total = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  // A page past the end is a 404 rather than an empty grid — keeps crawlers off infinite ranges.
  if (page > totalPages && total > 0) return null;

  const from = (page - 1) * perPage;
  const { data: rows } = await applyFilters(admin.from("blog_posts").select(POST_COLUMNS) as any)
    .order("published_at", { ascending: false, nullsFirst: false })
    .range(from, from + perPage - 1);

  const posts: BlogIndexPost[] = (rows ?? []).map(toIndexPost);

  return {
    posts,
    categories: categories.map(({ name, slug, description }) => ({ name, slug, description })),
    activeCategory: activeCategory
      ? { name: activeCategory.name, slug: activeCategory.slug, description: activeCategory.description }
      : null,
    page,
    totalPages,
  };
}
