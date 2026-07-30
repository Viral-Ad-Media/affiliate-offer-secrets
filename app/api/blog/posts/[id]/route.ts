import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { MAX_POST_TITLE, MAX_POST_CONTENT } from "@/lib/blog";

export const dynamic = "force-dynamic";

// Edit a post (title/content/category/status). Every write is scoped to (id, user_id) on the
// admin client — 0 rows updated means not-yours-or-nonexistent, generic 404 either way. Note
// there is deliberately NO server-side HTML sanitization of content_md at save time: the public
// route escapes at render time (lib/blog.ts's renderPostContentHtml — the same
// re-validate-at-render discipline as tracking snippets), so a hostile stored value can never
// reach a visitor as live HTML regardless of how it got stored.
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (typeof body.title === "string") {
    const title = body.title.trim().slice(0, MAX_POST_TITLE);
    if (!title) return NextResponse.json({ error: "title can't be empty" }, { status: 400 });
    patch.title = title;
  }
  if (typeof body.content_md === "string") {
    if (body.content_md.length > MAX_POST_CONTENT) {
      return NextResponse.json({ error: "post is too long" }, { status: 400 });
    }
    patch.content_md = body.content_md;
  }
  if (body.category_id === null) {
    patch.category_id = null;
  } else if (typeof body.category_id === "string") {
    // RLS-scoped read doubles as the ownership check — another tenant's category id is invisible.
    const { data: cat } = await supabase.from("blog_categories").select("id").eq("id", body.category_id).maybeSingle();
    if (!cat) return NextResponse.json({ error: "category not found" }, { status: 404 });
    patch.category_id = cat.id;
  }
  if (body.status === "draft" || body.status === "published") {
    patch.status = body.status;
    if (body.status === "published") patch.published_at = new Date().toISOString();
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("blog_posts")
    .update(patch)
    .eq("id", params.id)
    .eq("user_id", user.id)
    .select("id, title, status, category_id, published_at, updated_at");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data || data.length === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true, post: data[0] });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("blog_posts")
    .delete()
    .eq("id", params.id)
    .eq("user_id", user.id)
    .select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data || data.length === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
