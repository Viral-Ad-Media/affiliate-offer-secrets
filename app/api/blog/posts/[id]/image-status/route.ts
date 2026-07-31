import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// Poll target for FeaturedImageField while a generate_blog_image job runs. RLS-scoped read —
// another tenant's post id simply reads as nonexistent.
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const { data } = await supabase
    .from("blog_posts")
    .select("featured_image_url, featured_image_status, featured_image_error")
    .eq("id", params.id)
    .maybeSingle();
  if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });

  return NextResponse.json({
    status: data.featured_image_status,
    featured_image_url: data.featured_image_url,
    error: data.featured_image_error,
  });
}
