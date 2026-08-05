import { NextResponse } from "next/server";
import { currentWorkspaceId } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isValidEmail } from "@/lib/validate";
import {
  MailProviderError,
  verifyResendKey,
  verifySendgridKey,
  verifyMailgunKey,
  verifySmtp,
} from "@/lib/mail/providers";

export const dynamic = "force-dynamic";
// SMTP verification opens a real socket handshake — keep comfortably under any plan's limit but
// above the client timeouts in lib/mail/providers.ts.
export const maxDuration = 60;

const PROVIDERS = ["resend", "sendgrid", "mailgun", "smtp"] as const;
type Provider = (typeof PROVIDERS)[number];

// POST connects (or re-connects, replacing the stored credential) one provider. The credential is
// live-verified against the provider before anything is stored — a bad key is a clear 400 here,
// never a mystery failure on the first real send. This route never operates on another tenant's
// resource (same reasoning as /api/mail/send): the row written is always (auth.uid(), provider).
export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const ws = await currentWorkspaceId();

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const provider = body.provider as Provider;
  if (!PROVIDERS.includes(provider)) {
    return NextResponse.json({ error: "unknown provider" }, { status: 400 });
  }

  const fromAddress = typeof body.from_address === "string" ? body.from_address.trim() : "";
  if (!isValidEmail(fromAddress)) {
    return NextResponse.json({ error: "a valid from address is required" }, { status: 400 });
  }
  const fromName = typeof body.from_name === "string" ? body.from_name.trim().slice(0, 100) || null : null;

  // The single credential for this provider: an API key, or the SMTP password.
  const credential = typeof body.credential === "string" ? body.credential.trim() : "";
  if (!credential || credential.length > 2000) {
    return NextResponse.json({ error: "credential is required" }, { status: 400 });
  }

  let extra: Record<string, unknown> = {};

  try {
    if (provider === "resend") {
      await verifyResendKey(credential);
    } else if (provider === "sendgrid") {
      await verifySendgridKey(credential);
    } else if (provider === "mailgun") {
      const domain = typeof body.mailgun_domain === "string" ? body.mailgun_domain.trim().toLowerCase() : "";
      const region = body.mailgun_region === "eu" ? "eu" : "us";
      if (!domain || domain.length > 253 || !/^[a-z0-9.-]+$/.test(domain)) {
        return NextResponse.json({ error: "a valid Mailgun sending domain is required" }, { status: 400 });
      }
      await verifyMailgunKey(credential, domain, region);
      extra = { mailgun_domain: domain, mailgun_region: region };
    } else {
      const host = typeof body.smtp_host === "string" ? body.smtp_host.trim().toLowerCase() : "";
      const port = Number(body.smtp_port);
      const username = typeof body.smtp_username === "string" ? body.smtp_username.trim() : "";
      const secure = body.smtp_secure === true;
      if (!host || host.length > 253 || !/^[a-z0-9.-]+$/.test(host)) {
        return NextResponse.json({ error: "a valid SMTP host is required" }, { status: 400 });
      }
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        return NextResponse.json({ error: "a valid SMTP port is required" }, { status: 400 });
      }
      if (port === 25) {
        // Vercel blocks outbound port 25 — fail with a clear message now, not a timeout later.
        return NextResponse.json({ error: "port 25 is not supported — use 465 (TLS) or 587 (STARTTLS)" }, { status: 400 });
      }
      if (!username) {
        return NextResponse.json({ error: "an SMTP username is required" }, { status: 400 });
      }
      await verifySmtp({ host, port, username, password: credential, secure });
      extra = { smtp_host: host, smtp_port: port, smtp_username: username, smtp_secure: secure };
    }
  } catch (err) {
    const message = err instanceof MailProviderError ? err.message : "credential verification failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: secretId, error: storeErr } = await admin.rpc("store_oauth_secret", {
    p_token: credential,
    p_name: `mail_provider_${provider}_${user.id}`,
  });
  if (storeErr || !secretId) {
    return NextResponse.json({ error: "failed to store credential" }, { status: 500 });
  }

  // Re-connecting replaces the stored credential — repoint first, then delete the old secret
  // (same store-new-then-delete-old Vault hygiene as lib/google/mailToken.ts).
  const { data: existing } = await admin
    .from("mail_provider_connections")
    .select("id, secret_id")
    .eq("workspace_id", ws)
    .eq("provider", provider)
    .maybeSingle();

  const row = {
    user_id: user.id,
    // Explicit: this runs on the admin client, where auth.uid() is NULL and the
    // stamp_workspace_id trigger would fall back to the user's own workspace (0071/0072).
    workspace_id: ws,
    provider,
    secret_id: secretId,
    from_address: fromAddress,
    from_name: fromName,
    status: "connected",
    error: null,
    updated_at: new Date().toISOString(),
    ...extra,
  };

  const { error: upsertErr } = await admin
    .from("mail_provider_connections")
    .upsert(row, { onConflict: "workspace_id,provider" });
  if (upsertErr) {
    await admin.rpc("delete_oauth_secret", { p_secret_id: secretId });
    return NextResponse.json({ error: "failed to save connection" }, { status: 500 });
  }

  if (existing?.secret_id) {
    await admin.rpc("delete_oauth_secret", { p_secret_id: existing.secret_id });
  }

  return NextResponse.json({ ok: true });
}

// DELETE disconnects one provider: row + Vault secret gone; if it was the active sender, clear
// the pointer to NULL so it never dangles. (Was 'gmail' before 0037 retired that provider — a
// value the CHECK constraint now rejects outright.) NULL = no sender configured, which every
// caller already handles as not-connected.
export async function DELETE(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  const ws = await currentWorkspaceId();

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const provider = body.provider as Provider;
  if (!PROVIDERS.includes(provider)) {
    return NextResponse.json({ error: "unknown provider" }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: existing } = await admin
    .from("mail_provider_connections")
    .select("id, secret_id")
    .eq("workspace_id", ws)
    .eq("provider", provider)
    .maybeSingle();
  if (!existing) return NextResponse.json({ ok: true });

  await admin.from("mail_provider_connections").delete().eq("id", existing.id);
  await admin.rpc("delete_oauth_secret", { p_secret_id: existing.secret_id });
  // Clearing the workspace's pointer, not the person's — disconnecting the provider the
  // workspace was sending through has to stop the whole workspace sending through it.
  await admin
    .from("workspaces")
    .update({ active_mail_provider: null })
    .eq("id", ws)
    .eq("active_mail_provider", provider);

  return NextResponse.json({ ok: true });
}
