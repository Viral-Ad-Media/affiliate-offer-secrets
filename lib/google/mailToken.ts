import type { createAdminClient } from "@/lib/supabase/admin";
import { refreshGoogleAccessToken } from "./client";

type AdminClient = ReturnType<typeof createAdminClient>;

// Extracted from app/api/mail/send/route.ts (behavior-preserving) so the same refresh-or-fetch
// dance can run from a job stage too (lib/engine/broadcast.ts), which can't reuse a route's
// NextResponse.json(...)-shaped control flow. This would otherwise be the fifth independent copy
// of this exact logic (mail/send, youtube/upload, tiktok/post-video, and now broadcast).
export async function getValidMailAccessToken(
  admin: AdminClient,
  userId: string
): Promise<
  | { ok: true; accessToken: string; connectionId: string }
  | { ok: false; reason: "not_connected" | "needs_reconnect" }
> {
  const { data: conn } = await admin
    .from("mail_connections")
    .select("id, access_token_secret_id, refresh_token_secret_id, token_expires_at")
    .eq("user_id", userId)
    .single();
  if (!conn) return { ok: false, reason: "not_connected" };

  const expiresAt = conn.token_expires_at ? new Date(conn.token_expires_at).getTime() : 0;
  const needsRefresh = expiresAt < Date.now() + 2 * 60_000; // refresh a bit before actual expiry

  if (!needsRefresh) {
    const { data: token } = await admin.rpc("get_oauth_secret", {
      p_secret_id: conn.access_token_secret_id,
    });
    if (!token) return { ok: false, reason: "needs_reconnect" };
    return { ok: true, accessToken: token, connectionId: conn.id };
  }

  if (!conn.refresh_token_secret_id) return { ok: false, reason: "needs_reconnect" };

  const { data: refreshToken } = await admin.rpc("get_oauth_secret", {
    p_secret_id: conn.refresh_token_secret_id,
  });
  if (!refreshToken) return { ok: false, reason: "needs_reconnect" };

  try {
    const refreshed = await refreshGoogleAccessToken(refreshToken);
    const accessToken = refreshed.access_token;

    const { data: newSecretId, error: storeErr } = await admin.rpc("store_oauth_secret", {
      p_token: accessToken,
      p_name: `mail_access_token_${userId}`,
    });
    if (storeErr) throw new Error(storeErr.message);

    // Delete the old access-token secret immediately after repointing — Google tokens expire
    // hourly, so without this vault.secrets grows unbounded for active users.
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

    return { ok: true, accessToken, connectionId: conn.id };
  } catch {
    await admin.from("mail_connections").update({ status: "needs_reconnect" }).eq("id", conn.id);
    return { ok: false, reason: "needs_reconnect" };
  }
}
