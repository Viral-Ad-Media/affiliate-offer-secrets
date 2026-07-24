import Link from "next/link";
import { redirect } from "next/navigation";
import { LogOut, Coins, Clock, Link2 } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { hasAppAccess } from "@/lib/shared";
import LogoutButton from "@/components/LogoutButton";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("access_granted, nickname, trial_ends_at")
    .eq("id", user.id)
    .single();

  if (!hasAppAccess(profile)) redirect("/billing");

  const onTrial = !profile?.access_granted && !!profile?.trial_ends_at;
  const trialDaysLeft = onTrial
    ? Math.max(0, Math.ceil((new Date(profile!.trial_ends_at!).getTime() - Date.now()) / 86_400_000))
    : 0;

  const { data: creditRows } = await supabase
    .from("credits_ledger")
    .select("delta")
    .eq("user_id", user.id);
  const creditBalance = (creditRows ?? []).reduce((sum, r) => sum + r.delta, 0);

  return (
    <div>
      <div className="border-b border-ink-700 bg-ink-900/60">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-2 text-xs text-zinc-400">
          <span>{user.email}</span>
          <div className="flex items-center gap-3">
            {onTrial && (
              <Link
                href="/billing"
                className="flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-amber-300 hover:border-amber-500"
              >
                <Clock className="h-3.5 w-3.5" /> Trial: {trialDaysLeft}{" "}
                {trialDaysLeft === 1 ? "day" : "days"} left
              </Link>
            )}
            <Link
              href="/billing"
              className="flex items-center gap-1.5 rounded-full border border-ink-600 px-2.5 py-1 text-emerald-300 hover:border-emerald-500"
            >
              <Coins className="h-3.5 w-3.5" /> {creditBalance} credits
            </Link>
            <Link
              href="/connections"
              className="flex items-center gap-1.5 rounded-full border border-ink-600 px-2.5 py-1 text-zinc-300 hover:border-ink-500 hover:text-zinc-100"
            >
              <Link2 className="h-3.5 w-3.5" /> Connections
            </Link>
            <LogoutButton>
              <LogOut className="h-3.5 w-3.5" /> Log out
            </LogoutButton>
          </div>
        </div>
      </div>
      {children}
    </div>
  );
}
