import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { MAX_CATEGORY_NAME, MAX_CATEGORY_DESCRIPTION, slugify } from "@/lib/blog";

export const dynamic = "force-dynamic";

// Create a blog category. Writes go through the admin client (blog tables have no client write
// grants — see 0030_blog.sql); user_id always comes from the live session, never the body.
export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim().slice(0, MAX_CATEGORY_NAME) : "";
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });
  const description =
    typeof body.description === "string" && body.description.trim()
      ? body.description.trim().slice(0, MAX_CATEGORY_DESCRIPTION)
      : null;

  const admin = createAdminClient();
  // Slug is the public filter key (/b/{blog}?category={slug}), unique per blog (0034). A name
  // that slugifies to nothing (all punctuation) or collides gets a suffix rather than a raw 500.
  const base = slugify(name) || "category";
  let slug = base;
  for (let n = 2; n <= 50; n++) {
    const { data: taken } = await admin
      .from("blog_categories")
      .select("id")
      .eq("user_id", user.id)
      .ilike("slug", slug)
      .maybeSingle();
    if (!taken) break;
    slug = `${base}-${n}`;
  }

  const { data, error } = await admin
    .from("blog_categories")
    .insert({ user_id: user.id, name, slug, description })
    .select("id, name, slug, description")
    .single();
  if (error) {
    const dup = error.message.includes("duplicate") || error.code === "23505";
    return NextResponse.json(
      { error: dup ? "You already have a category with that name" : error.message },
      { status: dup ? 409 : 500 }
    );
  }
  return NextResponse.json({ ok: true, category: data });
}
