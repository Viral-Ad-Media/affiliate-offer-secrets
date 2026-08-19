import { redirect } from "next/navigation";
import { currentWorkspaceId } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import BlogSettingsPanel from "@/components/BlogSettingsPanel";

export const dynamic = "force-dynamic";

// Static segment deliberately shadows /blog/[postId] — post ids are UUIDs, never "settings".
export default async function BlogSettingsPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const ws = await currentWorkspaceId();

  // Published posts only — the serving routes degrade a draft home to the list, so a draft in
  // this picker would be a setting that saves and visibly does nothing.
  const { data: publishedPosts } = await supabase
    .from("blog_posts")
    .select("id, title")
    .eq("workspace_id", ws)
    .eq("status", "published")
    .order("title");
  const homeOptions = (publishedPosts ?? []).map((p) => ({ id: p.id as string, title: p.title as string }));

  const { data: settings } = await supabase
    .from("blog_settings")
    .select("blog_title, author_name, slug, description, author_bio, author_avatar_url, permalink_style, toc_enabled, toc_title, toc_min_headings, home_post_id, comments_enabled, ratings_enabled, tracking")
    .eq("workspace_id", ws)
    .maybeSingle();

  return (
    <BlogSettingsPanel
      initial={
        settings ?? {
          blog_title: null,
          author_name: null,
          slug: null,
          description: null,
          author_bio: null,
          toc_enabled: null,
          toc_title: null,
          toc_min_headings: null,
          author_avatar_url: null,
          permalink_style: null,
          home_post_id: null,
          comments_enabled: null,
          ratings_enabled: null,
        }
      }
      homeOptions={homeOptions}
    />
  );
}
