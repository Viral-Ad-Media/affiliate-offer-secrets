import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { currentWorkspaceId } from "@/lib/workspace";
import { normalizeAttributeFields } from "@/lib/contactAttributes";

export const dynamic = "force-dynamic";

/**
 * Edit or delete one custom-field definition.
 *
 * **The key is deliberately immutable.** Changing it is exactly the operation this whole table
 * exists to prevent: every value already in `contacts.extra_fields` is filed under the old key, so
 * a rename silently strands them. The label is the editable thing; the key is chosen once.
 *
 * Both verbs re-resolve the row against the caller's workspace before touching it. These run on
 * the admin client, which bypasses RLS, so `.eq("workspace_id", ws)` IS the authorization — not a
 * filter. Same discipline as /api/contacts/bulk.
 */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const ws = await currentWorkspaceId();
  if (!ws) return NextResponse.json({ error: "no active workspace" }, { status: 401 });

  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("contact_attributes")
    .select("id, key")
    .eq("id", params.id)
    .eq("workspace_id", ws)
    .maybeSingle();
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // The body's `key` is ignored in favour of the stored one, so a caller can't rename by
  // supplying a different value — normalizeAttributeFields still validates the rest.
  const parsed = normalizeAttributeFields({ ...(await req.json().catch(() => ({}))), key: existing.key });
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const { key: _immutable, ...editable } = parsed.fields;
  const { data, error } = await admin
    .from("contact_attributes")
    .update({ ...editable, updated_at: new Date().toISOString() })
    .eq("id", params.id)
    .eq("workspace_id", ws)
    .select("id, key, label, field_type, options, description")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, attribute: data });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const ws = await currentWorkspaceId();
  if (!ws) return NextResponse.json({ error: "no active workspace" }, { status: 401 });

  // Deleting the DEFINITION never deletes collected values — they stay in contacts.extra_fields
  // under the same key, and the Contacts table falls back to showing the raw key. Cascading into
  // captured leads would make removing a field from the library destroy real customer data.
  const admin = createAdminClient();
  const { error } = await admin
    .from("contact_attributes")
    .delete()
    .eq("id", params.id)
    .eq("workspace_id", ws);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
