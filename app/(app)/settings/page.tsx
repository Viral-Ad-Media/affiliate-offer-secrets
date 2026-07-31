import { redirect } from "next/navigation";
import Link from "next/link";
import { CreditCard, Link2, Palette } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import ProfileSettings from "@/components/ProfileSettings";
import SecuritySettings from "@/components/SecuritySettings";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, timezone, created_at, access_granted, trial_ends_at")
    .eq("id", user.id)
    .single();

  const onTrial = !profile?.access_granted && !!profile?.trial_ends_at;

  return (
    <main className="max-w-2xl space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-zinc-100">Settings</h1>
        <p className="text-sm text-zinc-400">Your account, security, and preferences.</p>
      </header>

      <ProfileSettings
        email={user.email ?? ""}
        fullName={profile?.full_name ?? null}
        timezone={profile?.timezone ?? null}
        memberSince={(profile?.created_at as string) ?? user.created_at}
      />

      <SecuritySettings email={user.email ?? ""} />

      {/* Preferences that already live elsewhere are linked, not duplicated — two places to set
          the same thing is how they drift out of sync. */}
      <section className="card space-y-3 p-5">
        <div className="text-sm font-semibold text-zinc-100">Elsewhere</div>
        <SettingLink
          href="/billing"
          icon={<CreditCard className="h-4 w-4" />}
          title="Plan &amp; credits"
          desc={onTrial ? "You're on a trial." : profile?.access_granted ? "Access active." : "No access yet."}
        />
        <SettingLink
          href="/connections"
          icon={<Link2 className="h-4 w-4" />}
          title="Connections"
          desc="Affiliate networks, Meta, TikTok, YouTube, and your email sender."
        />
        <div className="flex items-start gap-3 rounded-lg border border-ink-700 px-3 py-2.5">
          <span className="mt-0.5 text-zinc-500">
            <Palette className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <div className="text-sm text-zinc-200">Appearance</div>
            <p className="text-xs text-zinc-500">
              Light, dark or system — set with the toggle at the bottom of the sidebar.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}

function SettingLink({
  href,
  icon,
  title,
  desc,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-start gap-3 rounded-lg border border-ink-700 px-3 py-2.5 hover:border-emerald-500/40 hover:bg-ink-800/50"
    >
      <span className="mt-0.5 text-zinc-500">{icon}</span>
      <div className="min-w-0">
        <div className="text-sm text-zinc-200">{title}</div>
        <p className="text-xs text-zinc-500">{desc}</p>
      </div>
    </Link>
  );
}
