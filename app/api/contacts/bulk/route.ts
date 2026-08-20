import { NextResponse } from "next/server";
import { currentWorkspaceId } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

// One request can touch at most this many leads. Not a security limit — the ownership filter below
// is — but an unbounded id array is an unbounded IN clause, and the UI only ever selects one page.
const MAX_BATCH = 500;

const ACTIONS = ["tag", "untag", "delete", "unsubscribe", "resubscribe", "approve"] as const;
type Action = (typeof ACTIONS)[number];

/**
 * Bulk actions over selected leads.
 *
 * The load-bearing detail: every write here runs on the admin client, which bypasses RLS, and the
 * request body supplies the contact ids. So the ids are re-resolved against
 * (workspace_id = caller's workspace) FIRST and every subsequent statement operates only on that
 * verified set — ids belonging to another workspace are silently dropped rather than acted on.
 * Same discipline as set_broadcast_sequence_contacts re-validating every element of its array:
 * a determined caller talks to the endpoint, not the UI, and "the UI only sends ids it rendered"
 * is not an authorization argument.
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

  const rawIds: unknown = body.contact_ids;
  if (!Array.isArray(rawIds) || rawIds.length === 0) {
    return NextResponse.json({ error: "no contacts selected" }, { status: 400 });
  }
  if (rawIds.length > MAX_BATCH) {
    return NextResponse.json({ error: `Select at most ${MAX_BATCH} leads at a time` }, { status: 400 });
  }
  const ids = Array.from(new Set(rawIds.filter((v): v is string => typeof v === "string")));
  if (ids.length === 0) return NextResponse.json({ error: "no contacts selected" }, { status: 400 });

  const admin = createAdminClient();

  // THE authorization step. Everything below uses `owned`, never `ids`.
  const { data: ownedRows, error: ownErr } = await admin
    .from("contacts")
    .select("id")
    .eq("workspace_id", ws)
    .in("id", ids);
  if (ownErr) return NextResponse.json({ error: ownErr.message }, { status: 500 });

  const owned = (ownedRows ?? []).map((r) => r.id);
  if (owned.length === 0) return NextResponse.json({ error: "not found" }, { status: 404 });

  if (action === "tag" || action === "untag") {
    const tagId = typeof body.tag_id === "string" ? body.tag_id : "";
    if (!tagId) return NextResponse.json({ error: "tag_id required" }, { status: 400 });

    // The tag is a second caller-supplied reference and gets the same treatment as the contacts —
    // without this, a caller could attach another workspace's tag to their own leads.
    const { data: tag } = await admin
      .from("contact_tags")
      .select("id")
      .eq("id", tagId)
      .eq("workspace_id", ws)
      .maybeSingle();
    if (!tag) return NextResponse.json({ error: "not found" }, { status: 404 });

    if (action === "tag") {
      // Re-tagging an already-tagged lead is a normal thing to do from a multi-select, so the
      // composite PK collision is ignored rather than surfaced as an error.
      const { error } = await admin.from("contact_tag_links").upsert(
        owned.map((contact_id) => ({ contact_id, tag_id: tagId, user_id: user.id })),
        { onConflict: "contact_id,tag_id", ignoreDuplicates: true }
      );
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true, affected: owned.length });
    }

    const { error } = await admin
      .from("contact_tag_links")
      .delete()
      .eq("tag_id", tagId)
      .eq("workspace_id", ws)
      .in("contact_id", owned);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, affected: owned.length });
  }

  if (action === "delete") {
    const { error } = await admin
      .from("contacts")
      .delete()
      .eq("workspace_id", ws)
      .in("id", owned);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, affected: owned.length });
  }

  // Clear a lead out of the moderation queue (0120) — it flows normally from here on, including
  // into future enrollments. Rejecting a flagged lead is just `delete`, above.
  if (action === "approve") {
    const { error } = await admin
      .from("contacts")
      .update({ review_status: "approved", review_reason: null })
      .eq("workspace_id", ws)
      .in("id", owned);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, affected: owned.length });
  }

  // unsubscribe / resubscribe. Global per contact, matching how the public unsubscribe link works
  // (0021) — there is deliberately no per-sequence suppression to diverge from.
  const { error } = await admin
    .from("contacts")
    .update({ unsubscribed_at: action === "unsubscribe" ? new Date().toISOString() : null })
    .eq("workspace_id", ws)
    .in("id", owned);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, affected: owned.length });
}
