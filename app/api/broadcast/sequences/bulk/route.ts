import { NextResponse } from "next/server";
import { currentWorkspaceId } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const MAX_BATCH = 100;
const ACTIONS = ["archive", "unarchive", "delete"] as const;
type Action = (typeof ACTIONS)[number];

/**
 * Bulk archive / restore / delete over selected email sequences.
 *
 * Same non-negotiable shape as every other bulk route here: writes run on the admin client, which
 * bypasses RLS, and the ids arrive in a request body — so they are re-resolved against the caller's
 * workspace FIRST and only that verified set is touched.
 *
 * DELETE REFUSES AN ACTIVE SEQUENCE, and that is the whole reason this route exists rather than a
 * loop over `delete_broadcast_sequence`. That RPC checks membership and nothing else, so it will
 * happily delete a sequence mid-send — `broadcast_enrollments` and `broadcast_enrollment_steps`
 * cascade, so every contact's remaining scheduled emails disappear with no record that they were
 * ever due. The single-item UI only offers delete on a DRAFT; a bulk path that deleted active ones
 * would be strictly more destructive than the button it stands in for. Pause it first, or archive.
 *
 * ARCHIVE (0103) is the answer for a sequence you're finished with but that has really sent mail:
 * it leaves `status` alone, so an archived-but-active sequence keeps sending and the list says so.
 * Folding the two together would make tidying a list silently stop someone's drip.
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

  const raw: unknown = body.sequence_ids;
  if (!Array.isArray(raw) || raw.length === 0) {
    return NextResponse.json({ error: "no sequences selected" }, { status: 400 });
  }
  if (raw.length > MAX_BATCH) {
    return NextResponse.json({ error: `Select at most ${MAX_BATCH} sequences at a time` }, { status: 400 });
  }
  const requested = Array.from(new Set(raw.filter((v): v is string => typeof v === "string")));
  if (requested.length === 0) {
    return NextResponse.json({ error: "no sequences selected" }, { status: 400 });
  }

  // THE authorization step. Everything below reads from `rows`, never from `requested`.
  const { data: rows, error: ownErr } = await supabase
    .from("broadcast_sequences")
    .select("id, name, status")
    .eq("workspace_id", ws)
    .in("id", requested);
  if (ownErr) return NextResponse.json({ error: ownErr.message }, { status: 500 });
  if (!rows || rows.length === 0) {
    return NextResponse.json({ error: "no sequences found" }, { status: 404 });
  }

  const admin = createAdminClient();

  if (action === "archive" || action === "unarchive") {
    const ids = rows.map((r) => r.id as string);
    const { error } = await admin
      .from("broadcast_sequences")
      .update({ archived_at: action === "archive" ? new Date().toISOString() : null })
      .eq("workspace_id", ws)
      .in("id", ids);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, action, updated: ids.length, skipped: [] });
  }

  if (body.confirm !== true) {
    return NextResponse.json({ error: "delete needs confirmation" }, { status: 400 });
  }

  const deletable = rows.filter((r) => r.status !== "active");
  const skipped = rows
    .filter((r) => r.status === "active")
    .map((r) => ({ id: r.id as string, reason: "it's still sending — pause it first, or archive it" }));

  if (deletable.length > 0) {
    // Cascades broadcast_steps, broadcast_enrollments and broadcast_enrollment_steps;
    // broadcast_sends is SET NULL, so the record that mail went out survives the sequence — which
    // matters beyond history, because the pooled daily send cap counts those rows.
    const { error } = await admin
      .from("broadcast_sequences")
      .delete()
      .eq("workspace_id", ws)
      .in(
        "id",
        deletable.map((r) => r.id as string)
      );
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Partial success reported as success WITH refusals — some really were deleted, and a 400 would
  // invite a retry that does nothing but confuse.
  return NextResponse.json({ ok: true, action, updated: deletable.length, skipped });
}
