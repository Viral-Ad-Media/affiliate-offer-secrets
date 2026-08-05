// Per-provider verify + send clients for the mail-provider connections (Resend / SendGrid /
// Mailgun native APIs + generic SMTP). Server-only — every function here handles a live
// credential fetched from Vault by the caller (lib/mail/send.ts or the connect route); nothing
// in this file touches the database. All three HTTP APIs' endpoint/auth shapes were live-verified
// (401 + documented error JSON against each real endpoint) before this file was written, per
// this repo's standing rule for external integrations.

import nodemailer from "nodemailer";

export type SendArgs = { from: string; to: string; subject: string; html: string; replyTo?: string | null };

export type SmtpConfig = {
  host: string;
  port: number;
  username: string;
  password: string;
  // true = TLS from the first byte (typically port 465); false = plain connect upgraded via
  // STARTTLS (typically 587). Stored per-connection since providers differ.
  secure: boolean;
};

class MailProviderError extends Error {
  constructor(
    message: string,
    // Auth-shaped failures (bad/revoked key, rejected login) flip the connection row to
    // status='error' at the dispatch layer; transient failures don't.
    public readonly isAuthError: boolean
  ) {
    super(message);
  }
}
export { MailProviderError };

async function readError(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  return text.slice(0, 500) || `HTTP ${res.status}`;
}

// ---------------------------------------------------------------------------------------------
// Resend — https://api.resend.com, Bearer auth.
// ---------------------------------------------------------------------------------------------

export async function verifyResendKey(apiKey: string): Promise<void> {
  const res = await fetch("https://api.resend.com/domains", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (res.status === 401 || res.status === 403) throw new MailProviderError("Resend rejected this API key", true);
  if (!res.ok) throw new MailProviderError(`Resend verification failed: ${await readError(res)}`, false);
}

export async function sendResendEmail(apiKey: string, args: SendArgs): Promise<string | null> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: args.from,
      to: [args.to],
      subject: args.subject,
      html: args.html,
      ...(args.replyTo ? { reply_to: args.replyTo } : {}),
    }),
  });
  if (res.status === 401 || res.status === 403) throw new MailProviderError("Resend rejected this API key", true);
  if (!res.ok) throw new MailProviderError(`Resend send failed: ${await readError(res)}`, false);
  const data = (await res.json()) as { id?: string };
  return data.id ?? null;
}

// ---------------------------------------------------------------------------------------------
// SendGrid — https://api.sendgrid.com/v3, Bearer auth. Successful send is a 202 with the message
// id in the X-Message-Id response header, not a JSON body.
// ---------------------------------------------------------------------------------------------

export async function verifySendgridKey(apiKey: string): Promise<void> {
  const res = await fetch("https://api.sendgrid.com/v3/scopes", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (res.status === 401 || res.status === 403) throw new MailProviderError("SendGrid rejected this API key", true);
  if (!res.ok) throw new MailProviderError(`SendGrid verification failed: ${await readError(res)}`, false);
}

export async function sendSendgridEmail(apiKey: string, args: SendArgs, fromName: string | null): Promise<string | null> {
  const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: args.to }] }],
      from: fromName ? { email: args.from, name: fromName } : { email: args.from },
      ...(args.replyTo ? { reply_to: { email: args.replyTo } } : {}),
      subject: args.subject,
      content: [{ type: "text/html", value: args.html }],
    }),
  });
  if (res.status === 401 || res.status === 403) throw new MailProviderError("SendGrid rejected this API key", true);
  if (!res.ok) throw new MailProviderError(`SendGrid send failed: ${await readError(res)}`, false);
  return res.headers.get("x-message-id");
}

// ---------------------------------------------------------------------------------------------
// Mailgun — https://api(.eu)?.mailgun.net/v3/{domain}, HTTP basic auth ("api" + key),
// form-encoded body. The sending domain is part of every URL, so it's stored on the connection.
// ---------------------------------------------------------------------------------------------

function mailgunBase(region: "us" | "eu"): string {
  return region === "eu" ? "https://api.eu.mailgun.net" : "https://api.mailgun.net";
}

function mailgunAuth(apiKey: string): string {
  return `Basic ${Buffer.from(`api:${apiKey}`).toString("base64")}`;
}

export async function verifyMailgunKey(apiKey: string, domain: string, region: "us" | "eu"): Promise<void> {
  const res = await fetch(`${mailgunBase(region)}/v3/domains/${encodeURIComponent(domain)}`, {
    headers: { Authorization: mailgunAuth(apiKey) },
  });
  if (res.status === 401 || res.status === 403) throw new MailProviderError("Mailgun rejected this API key", true);
  if (res.status === 404) throw new MailProviderError(`Mailgun domain "${domain}" not found on this account`, true);
  if (!res.ok) throw new MailProviderError(`Mailgun verification failed: ${await readError(res)}`, false);
}

export async function sendMailgunEmail(
  apiKey: string,
  domain: string,
  region: "us" | "eu",
  args: SendArgs
): Promise<string | null> {
  const form = new URLSearchParams({ from: args.from, to: args.to, subject: args.subject, html: args.html });
  // Mailgun takes reply-to as a pass-through custom header rather than a first-class field.
  if (args.replyTo) form.set("h:Reply-To", args.replyTo);
  const res = await fetch(`${mailgunBase(region)}/v3/${encodeURIComponent(domain)}/messages`, {
    method: "POST",
    headers: { Authorization: mailgunAuth(apiKey), "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  if (res.status === 401 || res.status === 403) throw new MailProviderError("Mailgun rejected this API key", true);
  if (!res.ok) throw new MailProviderError(`Mailgun send failed: ${await readError(res)}`, false);
  const data = (await res.json()) as { id?: string };
  return data.id ?? null;
}

// ---------------------------------------------------------------------------------------------
// Generic SMTP — nodemailer. Covers any provider's SMTP endpoint (SES, Zoho, Postmark, a
// provider's SMTP relay, etc.). Vercel blocks outbound port 25; 465/587 work — the connect
// route rejects port 25 up front with a clear message rather than a timeout.
// ---------------------------------------------------------------------------------------------

function smtpTransport(config: SmtpConfig) {
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.username, pass: config.password },
    // A hung SMTP server should fail fast, not eat a serverless function's whole duration.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
}

function isSmtpAuthError(err: unknown): boolean {
  const code = (err as { responseCode?: number } | null)?.responseCode;
  // 535 = authentication credentials invalid; 534 = auth mechanism issues; 530 = auth required.
  return code === 535 || code === 534 || code === 530;
}

export async function verifySmtp(config: SmtpConfig): Promise<void> {
  try {
    await smtpTransport(config).verify();
  } catch (err: any) {
    throw new MailProviderError(`SMTP verification failed: ${err?.message ?? "connection error"}`, isSmtpAuthError(err));
  }
}

export async function sendSmtpEmail(config: SmtpConfig, args: SendArgs): Promise<string | null> {
  try {
    const info = await smtpTransport(config).sendMail({
      from: args.from,
      to: args.to,
      subject: args.subject,
      html: args.html,
      ...(args.replyTo ? { replyTo: args.replyTo } : {}),
    });
    return info.messageId ?? null;
  } catch (err: any) {
    throw new MailProviderError(`SMTP send failed: ${err?.message ?? "connection error"}`, isSmtpAuthError(err));
  }
}
