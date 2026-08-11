import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { readSignedRequest } from "@/lib/meta/signedRequest";

export const dynamic = "force-dynamic";

// Called directly by Meta (registered as this app's "Deauthorize Callback URL") when a user
// revokes the app's access from their own Facebook settings — the only proactive signal we get
// for that event; token expiry alone won't catch it. The signed_request HMAC is verified before
// anything is touched (lib/meta/signedRequest.ts, shared with the data-deletion callback), same
// fail-closed shape as the Stripe webhook.
//
// Revoking is NOT deleting: this marks the connection as needing a reconnect and leaves the rows
// in place, because the tenant may simply re-authorise. A real "delete my data" request goes to
// app/api/meta/data-deletion/route.ts, which removes the rows and their Vault secrets outright.
export async function POST(req: Request) {
  const parsed = await readSignedRequest(req);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  }

  const admin = createAdminClient();

  // ALL matching connections, not one. `meta_connections` is UNIQUE (workspace_id) — one Meta
  // connection per workspace — but nothing stops the SAME Facebook account being connected in
  // several workspaces, and this lookup is by `fb_user_id`. `.maybeSingle()` (what this used)
  // does not return the first of several, it ERRORS; the error was discarded, so `connection`
  // came back null and a revoke by anyone in two workspaces silently marked nothing at all.
  // Verified against the live constraint rather than assumed from the schema notes.
  const { data: connections } = await admin
    .from("meta_connections")
    .select("id")
    .eq("fb_user_id", parsed.fbUserId);

  const connectionIds = (connections ?? []).map((c) => c.id as string);
  if (connectionIds.length === 0) return NextResponse.json({ ok: true });

  await admin
    .from("meta_connections")
    .update({ status: "needs_reconnect", updated_at: new Date().toISOString() })
    .in("id", connectionIds);

  // Scoped by connection rather than by workspace. Equivalent in effect today (one connection per
  // workspace, so a workspace's Pages all belong to it), but it says what is actually meant and
  // stops being a correctness question if that uniqueness ever widens.
  await admin.from("meta_pages").update({ status: "needs_reconnect" }).in("connection_id", connectionIds);

  return NextResponse.json({ ok: true });
}
