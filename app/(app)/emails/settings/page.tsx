import { redirect } from "next/navigation";
import Link from "next/link";
import { currentWorkspaceId } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import EmailSettingsPanel from "@/components/EmailSettingsPanel";
import { EMAIL_SETTINGS_COLUMNS, type EmailSettings } from "@/lib/emailSettings";

// Sender IDENTITY — who replies go to, and who the sender legally is. Transport (the provider API
// key, the SMTP host, the verified from-address) stays on Settings → Integrations with the other
// connections: it's the same kind of thing as a Facebook token, and it changes for different
// reasons than this does.
export default async function EmailSettingsPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const ws = await currentWorkspaceId();
  const { data } = ws
    ? await supabase.from("email_settings").select(EMAIL_SETTINGS_COLUMNS).eq("workspace_id", ws).maybeSingle()
    : { data: null };

  return (
    <main className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-zinc-100">Email settings</h1>
        <p className="text-sm text-zinc-400">
          Who your email comes from and where replies go. The sending provider itself — API key,
          SMTP host, from-address — is on{" "}
          <Link href="/settings/integrations" className="underline hover:text-zinc-200">
            Integrations
          </Link>
          .
        </p>
      </header>

      <EmailSettingsPanel initial={(data ?? {}) as EmailSettings} />

      {/* Deliverability is decided in DNS, not in this app — so this is guidance, not a setting.
          A DKIM/SPF management UI can't exist here honestly: the records live on the tenant's
          sending domain at their DNS host, and their provider is the one that issues the DKIM
          values. Saying so beats a form that pretends otherwise. */}
      <section className="rounded-lg border border-ink-700 bg-ink-900 p-4 text-sm">
        <h2 className="font-semibold text-zinc-100">Deliverability: authenticate your sending domain</h2>
        <p className="mt-1 text-zinc-400">
          Gmail and Yahoo now require bulk senders to pass <strong>SPF</strong> and{" "}
          <strong>DKIM</strong>, and unauthenticated mail is rejected or spam-foldered. Both are DNS
          records on the domain you send from, created at your DNS host — not settings inside this
          app.
        </p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-zinc-400">
          <li>
            In your provider (Resend, SendGrid or Mailgun), open domain authentication — it lists the
            exact CNAME/TXT records to add. Add them at your DNS host, then verify in the provider.
          </li>
          <li>
            SPF is one TXT record per domain: if one already exists, add the provider&apos;s{" "}
            <code className="text-zinc-300">include:</code> to it — a second SPF record makes every
            check fail.
          </li>
          <li>
            Add a <code className="text-zinc-300">_dmarc</code> TXT (start with{" "}
            <code className="text-zinc-300">v=DMARC1; p=none;</code>) to monitor before enforcing.
          </li>
        </ul>
        <p className="mt-2 text-xs text-zinc-500">
          The from-address you connected on Integrations must belong to the authenticated domain, or
          the provider refuses the send.
        </p>
      </section>
    </main>
  );
}
