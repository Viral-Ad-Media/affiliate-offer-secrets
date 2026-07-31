import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import BlogHomeEditor from "@/components/BlogHomeEditor";
import type { BlogIndexPost } from "@/lib/blog";

export const dynamic = "force-dynamic";

// Static segment, deliberately shadowing /blog/[postId] — post ids are UUIDs, never "home"
// (same reasoning as /blog/categories and /blog/settings).
export default async function BlogHomePage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: settings }, { data: rows }] = await Promise.all([
    supabase
      .from("blog_settings")
      .select(
        "blog_title, slug, description, author_name, author_bio, author_avatar_url, permalink_style, intro_copy, intro_html"
      )
      .maybeSingle(),
    // The editor's own Preview renders the whole index, so it needs the real posts — drafts
    // included, matching what the saved-preview iframe shows.
    supabase
      .from("blog_posts")
      .select(
        "id, title, slug, excerpt, content_md, html, featured_image_url, published_at, blog_categories(name, slug)"
      )
      .order("published_at", { ascending: false, nullsFirst: true })
      .limit(24),
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

  return <BlogHomeEditor settings={settings ?? {}} posts={posts} />;
}
