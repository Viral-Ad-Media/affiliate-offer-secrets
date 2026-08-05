import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import MailProvidersPanel, { type MailProvidersStatus } from "@/components/MailProvidersPanel";

// Who your email comes from. This used to live buried on Settings → Integrations between Facebook
// and TikTok, which is where you'd connect an account — not where you'd look when a broadcast
// won't send. It's one page, moved, not copied: two places editing the active sender would
// eventually disagree about which one is authoritative.
export default async function EmailSettingsPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const mailProviders = await supabase
    .rpc("get_mail_provider_connections")
    .then((r) => (r.data ?? { active_provider: null, providers: [] }) as MailProvidersStatus);

  return (
    <main className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-zinc-100">Email settings</h1>
        <p className="text-sm text-zinc-400">
          The address your broadcasts and sequences send from. Exactly one provider is active at a
          time — everything that sends email goes through it.
        </p>
      </header>

      <MailProvidersPanel status={mailProviders} />

      <p className="text-xs text-zinc-500">
        Connecting a Gmail account instead? That&apos;s an OAuth connection, so it lives with the
        rest of them on{" "}
        <Link href="/settings/integrations" className="underline hover:text-zinc-300">
          Integrations
        </Link>
        .
      </p>
    </main>
  );
}
