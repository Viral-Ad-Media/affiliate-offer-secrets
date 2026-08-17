import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { currentWorkspaceId, workspaceRequiredResponse } from "@/lib/workspace";
import { verifyTwilioCredentials, toE164, TwilioError } from "@/lib/twilio/client";

export const dynamic = "force-dynamic";

/**
 * Connect (or replace) this workspace's SMS sender.
 *
 * Credentials are VERIFIED LIVE before anything is stored, the rule the mail providers already
 * follow: a bad token becomes a clear error while someone is looking at the form, instead of a
 * mystery failure on the first real send. A rejected credential stores nothing — no row, and no
 * orphaned Vault secret.
 */
export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const ws = await currentWorkspaceId();
  if (!ws) return workspaceRequiredResponse();

  const body = await req.json().catch(() => ({}));
  const accountSid = String(body.account_sid ?? "").trim();
  const authToken = String(body.auth_token ?? "").trim();
  const fromNumber = toE164(String(body.from_number ?? ""));

  if (!accountSid || !authToken) {
    return NextResponse.json({ error: "Account SID and auth token are required" }, { status: 400 });
  }
  if (!fromNumber) {
    return NextResponse.json(
      { error: "From number must be a valid phone number, e.g. +15551234567" },
      { status: 400 }
    );
  }

  try {
    await verifyTwilioCredentials(accountSid, authToken);
  } catch (err) {
    const message = err instanceof TwilioError ? err.message : "Could not verify these credentials";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const admin = createAdminClient();

  // Vault, via the generic helper every non-Meta connector uses. Named deterministically so a
  // reconnect UPDATES the existing secret rather than orphaning it — 0090's lesson, where a
  // create-only helper plus a delete that didn't clean up made "connect, disconnect, connect
  // again" permanently impossible.
  const { data: secretId, error: secretErr } = await admin.rpc("store_oauth_secret", {
    p_name: `sms_twilio_token_${ws}`,
    p_secret: authToken,
  });
  if (secretErr || !secretId) {
    return NextResponse.json({ error: "Could not store the credential securely" }, { status: 500 });
  }

  const { error } = await admin.from("sms_connections").upsert(
    {
      workspace_id: ws,
      user_id: user.id,
      provider: "twilio",
      account_sid: accountSid,
      auth_token_secret_id: secretId,
      from_number: fromNumber,
      status: "active",
      error_message: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "workspace_id" }
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ connected: true, from_number: fromNumber });
}

export async function DELETE() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const ws = await currentWorkspaceId();
  if (!ws) return workspaceRequiredResponse();

  const admin = createAdminClient();
  // Collect the secret id BEFORE deleting the row, then remove the secret — deleting the row first
  // strands it in the vault with nothing pointing at it. Same ordering disconnect_meta needed.
  const { data: conn } = await admin
    .from("sms_connections")
    .select("auth_token_secret_id")
    .eq("workspace_id", ws)
    .maybeSingle();

  await admin.from("sms_connections").delete().eq("workspace_id", ws);
  if (conn?.auth_token_secret_id) {
    await admin.rpc("delete_oauth_secret", { p_secret_id: conn.auth_token_secret_id }).then(
      () => null,
      () => null
    );
  }
  return NextResponse.json({ connected: false });
}
