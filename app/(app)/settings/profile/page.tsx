import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Palette } from "lucide-react";
import ProfileSettings from "@/components/ProfileSettings";
import ThemeToggle from "@/components/ThemeToggle";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("first_name, last_name, timezone, avatar_url, created_at")
    .eq("id", user.id)
    .single();

  return (
    <main className="max-w-2xl space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-zinc-100">Profile</h1>
        <p className="text-sm text-zinc-400">Your name, timezone and account details.</p>
      </header>
      <ProfileSettings
        email={user.email ?? ""}
        firstName={profile?.first_name ?? null}
        lastName={profile?.last_name ?? null}
        avatarUrl={profile?.avatar_url ?? null}
        timezone={profile?.timezone ?? null}
        memberSince={(profile?.created_at as string) ?? user.created_at}
      />

      <section className="card space-y-3 p-5">
        <div className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
          <Palette className="h-4 w-4 text-emerald-400" /> Appearance
        </div>
        <p className="text-xs text-zinc-500">
          The same control as the one at the bottom of the sidebar, not a second setting.
        </p>
        <div className="max-w-xs">
          <ThemeToggle />
        </div>
      </section>
    </main>
  );
}
