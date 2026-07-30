import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import BlogPostEditor from "@/components/BlogPostEditor";

export const dynamic = "force-dynamic";

export default async function BlogPostPage({ params }: { params: { postId: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: post }, { data: categories }] = await Promise.all([
    // RLS-scoped — another tenant's post id reads as nonexistent.
    supabase
      .from("blog_posts")
      .select("id, title, content_md, page_copy, status, category_id, published_at, seo_title, seo_description, seo_index")
      .eq("id", params.postId)
      .maybeSingle(),
    supabase.from("blog_categories").select("id, name").eq("user_id", user.id).order("name"),
  ]);
  if (!post) notFound();

  return <BlogPostEditor post={post} categories={categories ?? []} />;
}
