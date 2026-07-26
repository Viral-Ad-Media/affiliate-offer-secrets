import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { hasAppAccess } from "@/lib/shared";
import Sidebar from "@/components/Sidebar";

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
    <div className="flex min-h-screen flex-col sm:flex-row">
      <Sidebar
        email={user.email ?? ""}
        onTrial={onTrial}
        trialDaysLeft={trialDaysLeft}
        creditBalance={creditBalance}
      />
      <div className="min-w-0 flex-1">
        <div className="mx-auto max-w-7xl px-4 py-6">{children}</div>
      </div>
    </div>
  );
}
