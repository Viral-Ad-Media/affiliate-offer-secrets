import { redirect, notFound } from "next/navigation";
import { currentWorkspaceId } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import BlogPostEditor from "@/components/BlogPostEditor";

export const dynamic = "force-dynamic";

export default async function BlogPostPage({ params }: { params: { postId: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const ws = await currentWorkspaceId();

  const [{ data: post }, { data: categories }] = await Promise.all([
    // RLS-scoped — another tenant's post id reads as nonexistent.
    supabase
      .from("blog_posts")
      .select(
        "id, title, slug, excerpt, content_md, page_copy, status, category_id, published_at, seo_title, seo_description, seo_index, featured_image_url, featured_image_status, featured_image_error, previous_version, previous_saved_at"
      )
      .eq("id", params.postId)
      .maybeSingle(),
    supabase.from("blog_categories").select("id, name").eq("workspace_id", ws).order("name"),
  ]);
  if (!post) notFound();

  return <BlogPostEditor post={post} categories={categories ?? []} />;
}
