import { redirect } from "next/navigation";
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

  const { data: settings } = await supabase
    .from("blog_settings")
    .select("blog_title, author_name, slug, description, author_bio, author_avatar_url")
    .eq("user_id", user.id)
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
          author_avatar_url: null,
        }
      }
    />
  );
}
