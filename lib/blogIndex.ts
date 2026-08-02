import type { createAdminClient } from "@/lib/supabase/admin";
import { POSTS_PER_PAGE, MAX_FEED_POSTS, type BlogIndexPost, type BlogIndexCategory } from "@/lib/blog";

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
  params: URLSearchParams
): Promise<BlogIndexData | null> {
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
  const totalPages = Math.max(1, Math.ceil(total / POSTS_PER_PAGE));
  // A page past the end is a 404 rather than an empty grid — keeps crawlers off infinite ranges.
  if (page > totalPages && total > 0) return null;

  const from = (page - 1) * POSTS_PER_PAGE;
  const { data: rows } = await applyFilters(admin.from("blog_posts").select(POST_COLUMNS) as any)
    .order("published_at", { ascending: false, nullsFirst: false })
    .range(from, from + POSTS_PER_PAGE - 1);

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
