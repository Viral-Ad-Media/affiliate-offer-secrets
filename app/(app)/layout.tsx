import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { hasAppAccess } from "@/lib/shared";
import Sidebar from "@/components/Sidebar";
import ReferralClaimer from "@/components/ReferralClaimer";
import NotificationsBell from "@/components/NotificationsBell";
import CreditsChip from "@/components/CreditsChip";
import TrialChip from "@/components/TrialChip";
import TopBarAccount from "@/components/TopBarAccount";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("access_granted, nickname, trial_ends_at, first_name, last_name, avatar_url")
    .eq("id", user.id)
    .single();

  if (!hasAppAccess(profile)) redirect("/settings/billing");

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
    <div className="flex min-h-screen flex-col sm:flex-row">
      <ReferralClaimer />
      <Sidebar
        email={user.email ?? ""}
        creditBalance={creditBalance}
        firstName={profile?.first_name ?? null}
        lastName={profile?.last_name ?? null}
        avatarUrl={profile?.avatar_url ?? null}
      />
      <div className="min-w-0 flex-1">
        {/* Desktop-only top bar. The bell lives here rather than in the sidebar: it's a global
            status affordance, and the sidebar is navigation. Mobile already has its own top bar
            inside Sidebar, which carries the bell there.
            Sticky to match the sidebar. It needs its own background — the page scrolls underneath
            it, and a transparent bar would let content show through. z-30 keeps it above page
            content but below dialogs (z-50) and toasts (z-100); the account and notification
            menus portal out to fixed positioning, so they're unaffected either way. */}
        <div className="sticky top-0 z-30 hidden items-center justify-end gap-2 border-b border-ink-700 bg-ink-900/80 px-4 py-2 backdrop-blur sm:flex">
          {/* Centered on the bar itself, not laid out between the other chips — absolute
              positioning is what keeps it centered on the page regardless of how wide the
              right-hand cluster grows. pointer-events are handed back to the chip alone so the
              transparent overlay never eats clicks meant for the bar. */}
          {onTrial && (
            <div className="pointer-events-none absolute inset-x-0 flex justify-center">
              <TrialChip trialDaysLeft={trialDaysLeft} className="pointer-events-auto" />
            </div>
          )}
          <CreditsChip creditBalance={creditBalance} />
          <NotificationsBell />
          <TopBarAccount
            email={user.email ?? ""}
            firstName={profile?.first_name ?? null}
            lastName={profile?.last_name ?? null}
            avatarUrl={profile?.avatar_url ?? null}
          />
        </div>
        {/* Mobile gets its own centered strip under the top bar — that bar already carries logo,
            credits, bell, account and the hamburger, and a sixth item would wrap. */}
        {onTrial && (
          <div className="flex justify-center border-b border-ink-700 bg-ink-900/60 px-4 py-2 sm:hidden">
            <TrialChip trialDaysLeft={trialDaysLeft} />
          </div>
        )}
        <div className="mx-auto max-w-7xl px-4 py-6">{children}</div>
      </div>
    </div>
  );
}
