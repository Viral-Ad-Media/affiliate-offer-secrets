import { redirect } from "next/navigation";
import { currentWorkspaceId } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import BlogCommentsQueue, { type CommentRow } from "@/components/BlogCommentsQueue";
import LoadFailed from "@/components/LoadFailed";

export const dynamic = "force-dynamic";

// Static segment deliberately shadows /blog/[postId] — post ids are UUIDs, never "comments",
// the categories/settings/home precedent.
export default async function BlogCommentsPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const ws = await currentWorkspaceId();

  // Error captured, not discarded — a failed query must never render as "nothing waiting"
  // (the LoadFailed/Domains-page lesson). Capped: past 500 undealt-with comments the queue has a
  // bigger problem than pagination.
  const { data, error } = await supabase
    .from("blog_comments")
    .select("id, post_id, author_name, author_email, body, rating, status, created_at, blog_posts(title)")
    .eq("workspace_id", ws)
    .order("created_at", { ascending: false })
    .limit(500);

  if (error) {
    return (
      <div className="space-y-4">
        <LoadFailed what="your comments" detail={error.message} />
      </div>
    );
  }

  const comments: CommentRow[] = (data ?? []).map((c: any) => ({
    id: c.id,
    post_id: c.post_id,
    post_title: c.blog_posts?.title ?? "Deleted post",
    author_name: c.author_name,
    author_email: c.author_email,
    body: c.body,
    rating: c.rating,
    status: c.status,
    created_at: c.created_at,
  }));

  return <BlogCommentsQueue comments={comments} />;
}
