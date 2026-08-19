import { NextResponse } from "next/server";
import { currentWorkspaceId } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isValidEmail, clampName } from "@/lib/validate";

export const dynamic = "force-dynamic";

// A lead's own form fields. Same caps as app/api/public/leads/route.ts uses for the anonymous
// write path — an operator editing their own workspace's data is a far higher trust level than a
// stranger posting a bridge form, but an unbounded jsonb column is an unbounded row either way.
const MAX_EXTRA_FIELDS = 20;
const MAX_EXTRA_KEY_CHARS = 64;
const MAX_EXTRA_VALUE_CHARS = 500;

function cleanExtraFields(raw: unknown): Record<string, string> | null {
  if (raw === undefined) return null; // field absent -> leave the column alone
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (Object.keys(out).length >= MAX_EXTRA_FIELDS) break;
    const key = k.trim().slice(0, MAX_EXTRA_KEY_CHARS);
    if (!key || typeof v !== "string") continue;
    out[key] = v.slice(0, MAX_EXTRA_VALUE_CHARS).trim();
  }
  return out;
}

// Edit one lead. `contacts` has owner-SELECT RLS and no client write grants (0017), so the write
// runs on the admin client — which bypasses RLS entirely, making the explicit
// .eq("workspace_id", ws) below the ACTUAL authorization boundary, not a filter. Never drop it.
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const ws = await currentWorkspaceId();
  if (!ws) return NextResponse.json({ error: "no workspace" }, { status: 400 });

  const body = await req.json().catch(() => ({}));

  const patch: Record<string, unknown> = {};

  if (body.last_name !== undefined) {
    patch.last_name = clampName(body.last_name) || null;
  }
  if (body.first_name !== undefined) {
    // clampName trims and caps; an emptied field becomes NULL rather than "", so the table's
    // "no name given" state stays a single value instead of two that render differently.
    const name = clampName(body.first_name);
    patch.first_name = name || null;
  }

  if (body.email !== undefined) {
    // Lowercased to match how /api/public/leads normalises on capture — the de-dupe index is a
    // plain (campaign_id, email) index, so case is only collapsed in application code. An edit
    // that skipped this could create a second row differing solely in case.
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!isValidEmail(email)) {
      return NextResponse.json({ error: "That doesn't look like a valid email address" }, { status: 400 });
    }
    patch.email = email;
  }

  const extra = cleanExtraFields(body.extra_fields);
  if (extra !== null) patch.extra_fields = extra;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("contacts")
    .update(patch)
    .eq("id", params.id)
    .eq("workspace_id", ws)
    .select("id, first_name, last_name, email, extra_fields");

  if (error) {
    // (campaign_id, email) is unique — changing an address to one already captured for the same
    // campaign collides. Worth naming explicitly; a raw constraint string tells the operator nothing.
    const dup = error.code === "23505" || error.message.includes("duplicate");
    return NextResponse.json(
      {
        error: dup
          ? "Another lead on this campaign already uses that email address"
          : error.message,
      },
      { status: dup ? 409 : 500 }
    );
  }
  if (!data || data.length === 0) return NextResponse.json({ error: "not found" }, { status: 404 });

  return NextResponse.json({ ok: true, contact: data[0] });
}
