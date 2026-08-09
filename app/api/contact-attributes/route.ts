import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { currentWorkspaceId } from "@/lib/workspace";
import { normalizeAttributeFields } from "@/lib/contactAttributes";

export const dynamic = "force-dynamic";

// The workspace's custom-field library (0082). Reads go through the RLS-scoped client; writes go
// through the admin client, because contact_attributes has no client write grants — and every
// admin-client insert must stamp workspace_id itself rather than leaning on stamp_workspace_id(),
// whose fallback is "this user's first owned workspace" and would file the row under the wrong
// workspace for anyone who belongs to two.

export async function GET() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const ws = await currentWorkspaceId();
  // A null workspace is not a filter value — .eq("workspace_id", null) becomes PostgREST's
  // eq.null, which Postgres refuses to cast to uuid, answering 500 where 401 was meant.
  if (!ws) return NextResponse.json({ error: "no active workspace" }, { status: 401 });

  const { data, error } = await supabase
    .from("contact_attributes")
    .select("id, key, label, field_type, options, description")
    .eq("workspace_id", ws)
    .order("label");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ attributes: data ?? [] });
}

export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const ws = await currentWorkspaceId();
  if (!ws) return NextResponse.json({ error: "no active workspace" }, { status: 401 });

  const parsed = normalizeAttributeFields(await req.json().catch(() => ({})));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("contact_attributes")
    .insert({ workspace_id: ws, user_id: user.id, ...parsed.fields })
    .select("id, key, label, field_type, options, description")
    .single();
  if (error) {
    const dup = error.code === "23505";
    return NextResponse.json(
      { error: dup ? `A field with the key "${parsed.fields.key}" already exists.` : error.message },
      { status: dup ? 409 : 500 }
    );
  }
  return NextResponse.json({ ok: true, attribute: data });
}
