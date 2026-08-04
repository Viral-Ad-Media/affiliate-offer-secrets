import { NextResponse } from "next/server";
import { currentWorkspaceId } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { MAX_CATEGORY_NAME, MAX_CATEGORY_DESCRIPTION } from "@/lib/blog";

export const dynamic = "force-dynamic";

// Delete a category. Posts in it survive (category_id -> null via the FK's on delete set null).
// Ownership is enforced by scoping the delete itself to (id, user_id) — 0 rows deleted means
// not-yours-or-nonexistent, same generic 404 either way.
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const ws = await currentWorkspaceId();

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("blog_categories")
    .delete()
    .eq("id", params.id)
    .eq("workspace_id", ws)
    .select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data || data.length === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

// Rename a category. Same (id, user_id)-scoped write as DELETE — 0 rows means
// not-yours-or-nonexistent, one generic 404 either way.
//
// The slug is deliberately NOT regenerated from the new name. It's the public filter key
// (/b/{blog}?category={slug}) and lib/blogIndex.ts 404s an unrecognized one, so re-slugging would
// turn every already-shared or indexed filter link into a dead end for a cosmetic gain.
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  const ws = await currentWorkspaceId();

  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim().slice(0, MAX_CATEGORY_NAME) : "";
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });
  // Absent = leave as-is; present-but-empty = clear it.
  const patch: { name: string; description?: string | null } = { name };
  if ("description" in body) {
    patch.description =
      typeof body.description === "string" && body.description.trim()
        ? body.description.trim().slice(0, MAX_CATEGORY_DESCRIPTION)
        : null;
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("blog_categories")
    .update(patch)
    .eq("id", params.id)
    .eq("workspace_id", ws)
    .select("id, name, slug, description");
  if (error) {
    const dup = error.message.includes("duplicate") || error.code === "23505";
    return NextResponse.json(
      { error: dup ? "You already have a category with that name" : error.message },
      { status: dup ? 409 : 500 }
    );
  }
  if (!data || data.length === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true, category: data[0] });
}
