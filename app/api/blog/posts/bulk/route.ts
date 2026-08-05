import { NextResponse } from "next/server";
import { currentWorkspaceId } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const MAX_BATCH = 200;
const ACTIONS = ["publish", "unpublish", "delete", "set_category"] as const;
type Action = (typeof ACTIONS)[number];

/**
 * Bulk actions over selected blog posts.
 *
 * Same shape and same reasoning as /api/contacts/bulk: every write runs on the admin client, which
 * bypasses RLS, and the ids come from the request body — so they are re-resolved against the
 * caller's workspace FIRST and every statement below touches only that verified set. Ids belonging
 * to another workspace are silently dropped rather than acted on.
 *
 * Publishing in bulk is a real publish: it sets published_at, so posts appear on the public index
 * and in the feeds exactly as a single publish would. There is no separate "bulk publish" path
 * with different semantics — that divergence is how a bulk action ends up quietly doing less than
 * the single one.
 */
export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const ws = await currentWorkspaceId();
  if (!ws) return NextResponse.json({ error: "no workspace" }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const action = body.action as Action;
  if (!ACTIONS.includes(action)) {
    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  }

  const raw: unknown = body.post_ids;
  if (!Array.isArray(raw) || raw.length === 0) {
    return NextResponse.json({ error: "no posts selected" }, { status: 400 });
  }
  if (raw.length > MAX_BATCH) {
    return NextResponse.json({ error: `Select at most ${MAX_BATCH} posts at a time` }, { status: 400 });
  }
  const ids = Array.from(new Set(raw.filter((v): v is string => typeof v === "string")));
  if (ids.length === 0) return NextResponse.json({ error: "no posts selected" }, { status: 400 });

  const admin = createAdminClient();

  // THE authorization step. Everything below uses `owned`, never `ids`.
  const { data: ownedRows, error: ownErr } = await admin
    .from("blog_posts")
    .select("id")
    .eq("workspace_id", ws)
    .in("id", ids);
  if (ownErr) return NextResponse.json({ error: ownErr.message }, { status: 500 });

  const owned = (ownedRows ?? []).map((r) => r.id);
  if (owned.length === 0) return NextResponse.json({ error: "not found" }, { status: 404 });

  if (action === "delete") {
    const { error } = await admin.from("blog_posts").delete().eq("workspace_id", ws).in("id", owned);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, affected: owned.length });
  }

  if (action === "set_category") {
    const categoryId = body.category_id === null ? null : (body.category_id as string);
    if (categoryId !== null) {
      // Second caller-supplied reference, so it gets its own ownership check — without it a caller
      // could file their posts under another workspace's category.
      const { data: cat } = await admin
        .from("blog_categories")
        .select("id")
        .eq("id", categoryId)
        .eq("workspace_id", ws)
        .maybeSingle();
      if (!cat) return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    const { error } = await admin
      .from("blog_posts")
      .update({ category_id: categoryId, updated_at: new Date().toISOString() })
      .eq("workspace_id", ws)
      .in("id", owned);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, affected: owned.length });
  }

  // publish / unpublish. published_at is stamped on publish and deliberately LEFT IN PLACE on
  // unpublish — it records when the post first went live, and clearing it would lose that on a
  // temporary retraction. The public routes gate on status, not on published_at.
  const patch: Record<string, unknown> = {
    status: action === "publish" ? "published" : "draft",
    updated_at: new Date().toISOString(),
  };
  if (action === "publish") patch.published_at = new Date().toISOString();

  const { error } = await admin
    .from("blog_posts")
    .update(patch)
    .eq("workspace_id", ws)
    .in("id", owned);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, affected: owned.length });
}
