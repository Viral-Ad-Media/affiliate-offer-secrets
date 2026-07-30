import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import BlogManager from "@/components/BlogManager";

export const dynamic = "force-dynamic";

// Blog manager: posts imported from campaigns' generated blog_md (or written from scratch),
// organized into user-created categories, published at public /b/{postId} URLs.
export default async function BlogPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: posts }, { data: categories }, { data: campaigns }] = await Promise.all([
    supabase
      .from("blog_posts")
      .select("id, title, status, category_id, campaign_id, published_at, updated_at")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false }),
    supabase.from("blog_categories").select("id, name").eq("user_id", user.id).order("name"),
    // Campaigns whose kit actually includes generated blog content — the import dropdown.
    supabase.from("campaigns").select("id, products(product_title)").not("blog_md", "is", null),
  ]);

  const importableCampaigns = (campaigns ?? [])
    .map((c) => ({ id: c.id as string, title: ((c as any).products?.product_title as string) ?? "Untitled campaign" }))
    .sort((a, b) => a.title.localeCompare(b.title));

  return (
    <BlogManager
      posts={posts ?? []}
      categories={categories ?? []}
      importableCampaigns={importableCampaigns}
    />
  );
}
