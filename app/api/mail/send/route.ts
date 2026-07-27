import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { refreshGoogleAccessToken, sendGmailMessage } from "@/lib/google/client";

export const dynamic = "force-dynamic";

// This route never operates on another tenant's resource — the mailbox used is always the
// caller's own connected mail_connections row (user_id = auth.uid()), and to/subject/html are
// freeform values the caller controls for their own send. No foreign resource-id parameter, so
// none of the cross-tenant-IDOR pattern seen elsewhere (Page IDs, IG account IDs) applies here.
export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const body = await req.json();
  const to = (body.to as string | undefined)?.trim();
  const subject = (body.subject as string | undefined)?.trim();
  const html = body.html as string | undefined;
  const campaignId = body.campaign_id as string | undefined;

  if (!to || !subject || !html) {
    return NextResponse.json({ error: "to, subject, and html are required" }, { status: 400 });
  }

  // Even though this route never operates on another tenant's resource, validate campaign_id
  // (when provided) via the existing assert_owns_campaign RPC before logging it — prevents a
  // landmine for any future feature that joins mail_sends -> campaigns via the admin client
  // without independently re-checking ownership. Design-review note.
  if (campaignId) {
    const { data: owns } = await supabase.rpc("assert_owns_campaign", { p_campaign_id: campaignId });
    if (!owns) {
      return NextResponse.json({ error: "campaign not found" }, { status: 404 });
    }
  }

  const admin = createAdminClient();

  const { data: conn } = await admin
    .from("mail_connections")
    .select("id, access_token_secret_id, refresh_token_secret_id, token_expires_at")
    .eq("user_id", user.id)
    .single();
  if (!conn) return NextResponse.json({ error: "mail not connected" }, { status: 404 });

  let accessToken: string;
  const expiresAt = conn.token_expires_at ? new Date(conn.token_expires_at).getTime() : 0;
  const needsRefresh = expiresAt < Date.now() + 2 * 60_000; // refresh a bit before actual expiry

  if (needsRefresh && conn.refresh_token_secret_id) {
    const { data: refreshToken } = await admin.rpc("get_oauth_secret", {
      p_secret_id: conn.refresh_token_secret_id,
    });
    if (!refreshToken) {
      return NextResponse.json({ error: "could not refresh mail connection" }, { status: 500 });
    }
    try {
      const refreshed = await refreshGoogleAccessToken(refreshToken);
      accessToken = refreshed.access_token;

      const { data: newSecretId, error: storeErr } = await admin.rpc("store_oauth_secret", {
        p_token: accessToken,
        p_name: `mail_access_token_${user.id}`,
      });
      if (storeErr) throw new Error(storeErr.message);

      // Delete the old access-token secret immediately after repointing — Google tokens expire
      // hourly, so without this vault.secrets grows unbounded for active users. Design-review fix.
      const oldSecretId = conn.access_token_secret_id;
      await admin
        .from("mail_connections")
        .update({
          access_token_secret_id: newSecretId,
          token_expires_at: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
          status: "connected",
        })
        .eq("id", conn.id);
      await admin.rpc("delete_oauth_secret", { p_secret_id: oldSecretId });
    } catch (err: any) {
      await admin.from("mail_connections").update({ status: "needs_reconnect" }).eq("id", conn.id);
      return NextResponse.json({ error: "mail connection needs to be reconnected" }, { status: 409 });
    }
  } else {
    const { data: token } = await admin.rpc("get_oauth_secret", {
      p_secret_id: conn.access_token_secret_id,
    });
    if (!token) return NextResponse.json({ error: "could not retrieve mail token" }, { status: 500 });
    accessToken = token;
  }

  try {
    const sent = await sendGmailMessage(accessToken, { to, subject, html });

    await admin.from("mail_sends").insert({
      user_id: user.id,
      campaign_id: campaignId ?? null,
      to_address: to,
      subject,
      message_id: sent.id,
    });

    return NextResponse.json({ ok: true, message_id: sent.id });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Failed to send" }, { status: 502 });
  }
}
