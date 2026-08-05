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
    </main>
  );
}
