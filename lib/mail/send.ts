// The one place every outgoing tenant email is dispatched from — both the one-off send route
// (app/api/mail/send/route.ts) and the Broadcast engine (lib/engine/broadcast.ts) call
// sendViaActiveSender() instead of talking to Gmail/providers directly, so "which provider does
// this account send with" is decided in exactly one place: profiles.active_mail_provider
// ('gmail' default — the pre-provider behavior — or one of the mail_provider_connections rows).
// Server-only (admin client + Vault RPCs); never import from client components.

import type { createAdminClient } from "@/lib/supabase/admin";
import { sendGmailMessage } from "@/lib/google/client";
import { getValidMailAccessToken } from "@/lib/google/mailToken";
import {
  MailProviderError,
  sendResendEmail,
  sendSendgridEmail,
  sendMailgunEmail,
  sendSmtpEmail,
} from "./providers";

type AdminClient = ReturnType<typeof createAdminClient>;

export type MailProvider = "gmail" | "resend" | "sendgrid" | "mailgun" | "smtp";

export type SendResult = { messageId: string | null; provider: MailProvider };

export type SendFailure = { ok: false; reason: "not_connected" | "needs_reconnect" };

// Resolves the active provider and sends. Auth-shaped provider failures (revoked API key,
// rejected SMTP login) flip the connection row to status='error' — mirroring Gmail's
// needs_reconnect degradation — so the UI surfaces "reconnect" instead of silently failing
// every future send. Throws on transient send errors (caller decides retry semantics).
export async function sendViaActiveSender(
  admin: AdminClient,
  userId: string,
  args: { to: string; subject: string; html: string }
): Promise<SendResult | SendFailure> {
  const { data: profile } = await admin
    .from("profiles")
    .select("active_mail_provider")
    .eq("id", userId)
    .maybeSingle();
  const provider = (profile?.active_mail_provider ?? "gmail") as MailProvider;

  if (provider === "gmail") {
    const tokenResult = await getValidMailAccessToken(admin, userId);
    if (!tokenResult.ok) return { ok: false, reason: tokenResult.reason };
    const sent = await sendGmailMessage(tokenResult.accessToken, args);
    return { messageId: sent.id, provider };
  }

  const { data: conn } = await admin
    .from("mail_provider_connections")
    .select("id, provider, secret_id, smtp_host, smtp_port, smtp_username, smtp_secure, mailgun_domain, mailgun_region, from_address, from_name, status")
    .eq("user_id", userId)
    .eq("provider", provider)
    .maybeSingle();
  if (!conn) return { ok: false, reason: "not_connected" };
  if (conn.status !== "connected") return { ok: false, reason: "needs_reconnect" };

  const { data: secret } = await admin.rpc("get_oauth_secret", { p_secret_id: conn.secret_id });
  if (!secret) return { ok: false, reason: "needs_reconnect" };

  const from = conn.from_name ? `${conn.from_name} <${conn.from_address}>` : conn.from_address;
  const sendArgs = { from, to: args.to, subject: args.subject, html: args.html };

  try {
    let messageId: string | null = null;
    switch (provider) {
      case "resend":
        messageId = await sendResendEmail(secret, sendArgs);
        break;
      case "sendgrid":
        messageId = await sendSendgridEmail(secret, sendArgs, conn.from_name);
        break;
      case "mailgun":
        messageId = await sendMailgunEmail(
          secret,
          conn.mailgun_domain as string,
          (conn.mailgun_region as "us" | "eu") ?? "us",
          sendArgs
        );
        break;
      case "smtp":
        messageId = await sendSmtpEmail(
          {
            host: conn.smtp_host as string,
            port: conn.smtp_port as number,
            username: conn.smtp_username as string,
            password: secret,
            secure: conn.smtp_secure ?? false,
          },
          sendArgs
        );
        break;
    }
    return { messageId, provider };
  } catch (err) {
    if (err instanceof MailProviderError && err.isAuthError) {
      await admin
        .from("mail_provider_connections")
        .update({ status: "error", error: err.message, updated_at: new Date().toISOString() })
        .eq("id", conn.id);
      return { ok: false, reason: "needs_reconnect" };
    }
    throw err;
  }
}

export function isSendFailure(r: SendResult | SendFailure): r is SendFailure {
  return (r as SendFailure).ok === false;
}
