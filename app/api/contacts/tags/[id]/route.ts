import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

// Rename or delete a tag. Both writes are scoped to (id, user_id) — 0 rows means
// not-yours-or-nonexistent, one generic 404 either way, same idiom as the blog category routes.
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const { data: ws } = await supabase.rpc("current_workspace_id");

  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 60) : "";
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("contact_tags")
    .update({ name })
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
  const { data: ws } = await supabase.rpc("current_workspace_id");

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
