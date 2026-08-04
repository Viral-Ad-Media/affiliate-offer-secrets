import { NextResponse } from "next/server";
import { currentWorkspaceId } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeTagFields } from "@/lib/contactTags";

export const dynamic = "force-dynamic";

// Edit or delete a tag. Both writes are scoped to (id, workspace_id) — 0 rows means
// not-yours-or-nonexistent, one generic 404 either way, same idiom as the blog category routes.
//
// Name, colour and description are all written on every PATCH, so clearing a description or
// removing a colour is expressible; a partial-patch shape would leave no way to unset either.
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const ws = await currentWorkspaceId();

  const body = await req.json().catch(() => ({}));
  const { name, color, description } = normalizeTagFields(body);
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("contact_tags")
    .update({ name, color, description })
    .eq("id", params.id)
    .eq("workspace_id", ws)
    .select("id");
  if (error) {
    const dup = error.code === "23505" || error.message.includes("duplicate");
    return NextResponse.json(
      { error: dup ? "You already have a tag with that name" : error.message },
      { status: dup ? 409 : 500 }
    );
  }
  if (!data || data.length === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  const ws = await currentWorkspaceId();

  const admin = createAdminClient();
  // Links cascade on tag delete — the contacts themselves are untouched, only the grouping goes.
  const { data, error } = await admin
    .from("contact_tags")
    .delete()
    .eq("id", params.id)
    .eq("workspace_id", ws)
    .select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data || data.length === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
