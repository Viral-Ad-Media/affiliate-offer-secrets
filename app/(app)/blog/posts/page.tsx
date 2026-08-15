import { redirect } from "next/navigation";
import { currentWorkspaceId } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import BlogManager from "@/components/BlogManager";
import LoadFailed from "@/components/LoadFailed";
import Pager, { PAGE_SIZE, pageFromParam, pageRange } from "@/components/Pager";
import { analyzePostSeo } from "@/lib/blogSeo";

export const dynamic = "force-dynamic";

// Blog manager: posts imported from campaigns' generated blog_md (or written from scratch),
// organized into user-created categories, published at public /b/{postId} URLs.
export default async function BlogPage({ searchParams }: { searchParams: { page?: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const ws = await currentWorkspaceId();

  const { count } = await supabase
    .from("blog_posts")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", ws);
  const total = count ?? 0;
  const page = pageFromParam(searchParams.page, Math.ceil(total / PAGE_SIZE));
  const [from, to] = pageRange(page);

  // Error captured, not discarded — a failed query must render as a failure, never as the "no
  // posts yet" empty state (see components/LoadFailed.tsx for the Domains-page incident).
  const [{ data: posts, error: postsError }, { data: categories }, { data: settings }] = await Promise.all([
    supabase
      .from("blog_posts")
      .select("id, title, slug, excerpt, html, status, category_id, campaign_id, published_at, updated_at, seo_title, seo_description, featured_image_url, blog_categories(slug)")
      .eq("workspace_id", ws)
      .order("updated_at", { ascending: false })
      .range(from, to),
    supabase.from("blog_categories").select("id, name").eq("workspace_id", ws).order("name"),
    supabase.from("blog_settings").select("slug, permalink_style").eq("workspace_id", ws).maybeSingle(),
  ]);

  if (postsError) {
    return (
      <div className="space-y-4">
        <LoadFailed what="your posts" detail={postsError.message} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <BlogManager
        posts={(posts ?? []).map((p) => ({
          ...p,
          category_slug: ((p as any).blog_categories?.slug as string | null) ?? null,
          // Scored here rather than in the client so the list stays a server component and the
          // number is the SAME analyzePostSeo the editor's panel runs — one definition of the
          // score, not a second approximation for the list.
          seo_score: analyzePostSeo({
            title: p.title,
            contentMd: "",
            html: (p as any).html,
            excerpt: (p as any).excerpt,
            seoTitle: (p as any).seo_title,
            seoDescription: (p as any).seo_description,
            featuredImageUrl: (p as any).featured_image_url,
            slug: p.slug,
          }).score,
        }))}
        categories={categories ?? []}
        blogSlug={settings?.slug ?? null}
        permalinkStyle={settings?.permalink_style ?? null}
      />
      <Pager page={page} total={total} basePath="/blog/posts" label="posts" />
    </div>
  );
}
