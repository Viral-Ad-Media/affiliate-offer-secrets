import { redirect } from "next/navigation";
import { currentWorkspaceId } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import BlogManager from "@/components/BlogManager";
import Pager, { PAGE_SIZE, pageFromParam, pageRange } from "@/components/Pager";

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

  const [{ data: posts }, { data: categories }] = await Promise.all([
    supabase
      .from("blog_posts")
      .select("id, title, status, category_id, campaign_id, published_at, updated_at")
      .eq("workspace_id", ws)
      .order("updated_at", { ascending: false })
      .range(from, to),
    supabase.from("blog_categories").select("id, name").eq("workspace_id", ws).order("name"),
  ]);

  return (
    <div className="space-y-4">
      <BlogManager posts={posts ?? []} categories={categories ?? []} />
      <Pager page={page} total={total} basePath="/blog" label="posts" />
    </div>
  );
}
