import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { MAX_BLOG_SETTING } from "@/lib/blog";

export const dynamic = "force-dynamic";

// Upsert the caller's blog settings (blog name + author byline, shown on public post pages).
// One row per user, keyed by the live session's uid — no client-suppliable tenant field.
export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const clean = (v: unknown) =>
    typeof v === "string" && v.trim() ? v.trim().slice(0, MAX_BLOG_SETTING) : null;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("blog_settings")
    .upsert(
      {
        user_id: user.id,
        blog_title: clean(body.blog_title),
        author_name: clean(body.author_name),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    )
    .select("blog_title, author_name")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, settings: data });
}
