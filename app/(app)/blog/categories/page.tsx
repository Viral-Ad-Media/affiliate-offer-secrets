import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import BlogCategoriesPanel from "@/components/BlogCategoriesPanel";

export const dynamic = "force-dynamic";

// Static segment deliberately shadows /blog/[postId] — post ids are UUIDs, never "categories".
export default async function BlogCategoriesPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: categories }, { data: posts }] = await Promise.all([
    supabase.from("blog_categories").select("id, name").eq("user_id", user.id).order("name"),
    supabase.from("blog_posts").select("category_id").eq("user_id", user.id),
  ]);

  const counts = new Map<string, number>();
  for (const p of posts ?? []) {
    if (p.category_id) counts.set(p.category_id, (counts.get(p.category_id) ?? 0) + 1);
  }

  return (
    <BlogCategoriesPanel
      categories={(categories ?? []).map((c) => ({ ...c, postCount: counts.get(c.id) ?? 0 }))}
    />
  );
}
