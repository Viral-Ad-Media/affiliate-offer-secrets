import { createClient } from "@/lib/supabase/server";
import { renderPublicPostHtml } from "@/lib/blog";

export const dynamic = "force-dynamic";

// Owner-only preview of one post as it will look published. The public route
// (app/b/[...path]) serves published posts only, so a draft had no viewable form outside the
// editor — this is what the Preview action on the posts list opens.
//
// Renders the SAVED content. The editor's own Preview button renders unsaved edits instead; both
// go through the same renderer, so they can't disagree about anything but freshness.
const HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "X-Robots-Tag": "noindex, nofollow",
  "Cache-Control": "no-store",
  "Referrer-Policy": "strict-origin-when-cross-origin",
};

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Not signed in", { status: 401 });

  // RLS-scoped: another tenant's post id simply reads as nonexistent, so no explicit ownership
  // check is needed and there's no draft/ownership oracle either way.
  const { data: post } = await supabase
    .from("blog_posts")
    .select(
      "id, title, slug, content_md, html, excerpt, featured_image_url, published_at, seo_title, seo_description, seo_index, blog_categories(name)"
    )
    .eq("id", params.id)
    .maybeSingle();
  if (!post) return new Response("Not found", { status: 404 });

  const { data: settings } = await supabase
    .from("blog_settings")
    .select("blog_title, slug, description, author_name, author_bio, author_avatar_url, permalink_style")
    .maybeSingle();

  const html = renderPublicPostHtml({
    id: post.id as string,
    title: post.title as string,
    slug: post.slug as string | null,
    content_md: (post.content_md as string) ?? "",
    html: post.html as string | null,
    excerpt: post.excerpt as string | null,
    featured_image_url: post.featured_image_url as string | null,
    // An unpublished post has no date; showing today is closer to the published article than a
    // blank byline, and matches what the editor's own preview does.
    published_at: (post.published_at as string | null) ?? new Date().toISOString(),
    category_name: (post.blog_categories as unknown as { name: string } | null)?.name ?? null,
    settings: settings ?? null,
    seo_title: post.seo_title as string | null,
    seo_description: post.seo_description as string | null,
    seo_index: post.seo_index as boolean,
  });
  return new Response(html, { status: 200, headers: HEADERS });
}
