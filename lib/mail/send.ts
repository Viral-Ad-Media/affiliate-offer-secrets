// The one place every outgoing tenant email is dispatched from — both the one-off send route
// (app/api/mail/send/route.ts) and the Broadcast engine (lib/engine/broadcast.ts) call
// sendViaActiveSender() instead of talking to providers directly, so "which provider does
// this account send with" is decided in exactly one place: profiles.active_mail_provider, which
// names one of the mail_provider_connections rows (Gmail was retired as a sender in 0037).
// Server-only (admin client + Vault RPCs); never import from client components.

import type { createAdminClient } from "@/lib/supabase/admin";
import { notify } from "@/lib/notifications";
import {
  MailProviderError,
  sendResendEmail,
  sendSendgridEmail,
  sendMailgunEmail,
  sendSmtpEmail,
} from "./providers";

type AdminClient = ReturnType<typeof createAdminClient>;

export type MailProvider = "resend" | "sendgrid" | "mailgun" | "smtp";

export type SendResult = { messageId: string | null; provider: MailProvider };

export type SendFailure = { ok: false; reason: "not_connected" | "needs_reconnect" };

// Resolves the active provider and sends. Auth-shaped provider failures (revoked API key,
// rejected SMTP login) flip the connection row to status='error' — mirroring Gmail's
// needs_reconnect degradation — so the UI surfaces "reconnect" instead of silently failing
// every future send. Throws on transient send errors (caller decides retry semantics).
export async function sendViaActiveSender(
  admin: AdminClient,
  userId: string,
  workspaceId: string,
  args: { to: string; subject: string; html: string }
): Promise<SendResult | SendFailure> {
  // Workspace, not user (0072). This used to read profiles.active_mail_provider — keyed by the
  // person — and then look the connection up by workspace_id just below, which only agrees while
  // a workspace has exactly one member. The Broadcast engine passes job.user_id, so whoever
  // happened to create a sequence silently decided the whole workspace's sending provider.
  const { data: workspace } = await admin
    .from("workspaces")
    .select("active_mail_provider")
    .eq("id", workspaceId)
    .maybeSingle();
  const provider = workspace?.active_mail_provider as MailProvider | null | undefined;

  // Null = no sender configured (0037 retired Gmail and dropped it as the implicit default).
  // Same "not_connected" outcome a brand-new account gets, so callers need no new branch.
  if (!provider) return { ok: false, reason: "not_connected" };

  const { data: conn } = await admin
    .from("mail_provider_connections")
    .select("id, provider, secret_id, smtp_host, smtp_port, smtp_username, smtp_secure, mailgun_domain, mailgun_region, from_address, from_name, status")
    .eq("workspace_id", workspaceId)
    .eq("provider", provider)
    .maybeSingle();
  if (!conn) return { ok: false, reason: "not_connected" };
  if (conn.status !== "connected") return { ok: false, reason: "needs_reconnect" };

  const { data: secret } = await admin.rpc("get_oauth_secret", { p_secret_id: conn.secret_id });
  if (!secret) return { ok: false, reason: "needs_reconnect" };

  const from = conn.from_name ? `${conn.from_name} <${conn.from_address}>` : conn.from_address;

  // Reply-to is resolved here rather than passed in by callers, so every send path picks it up
  // without each one having to remember — the same reason the active provider is resolved here.
  // The from-address is often a verified sending domain nobody reads; replies belong elsewhere.
  const { data: emailSettings } = await admin
    .from("email_settings")
    .select("reply_to")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  const replyTo = (emailSettings?.reply_to as string | null) ?? null;
  const sendArgs = { from, to: args.to, subject: args.subject, html: args.html, replyTo };

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
      // A rejected key silently stops EVERY future send — broadcasts included — so this must
      // surface rather than showing up as mail that just quietly never arrives.
      await notify(admin, userId, {
        kind: "mail_sender_error",
        title: `${provider} rejected your credentials`,
        body: "Email sending is paused until you reconnect this provider.",
        href: "/settings/integrations",
      });
      return { ok: false, reason: "needs_reconnect" };
    }
    throw err;
  }
}

export function isSendFailure(r: SendResult | SendFailure): r is SendFailure {
  return (r as SendFailure).ok === false;
}
