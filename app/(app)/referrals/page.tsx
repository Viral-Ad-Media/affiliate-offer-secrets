import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import ReferralPanel, { type ReferralRow } from "@/components/ReferralPanel";

export const dynamic = "force-dynamic";

const MAX_REFERRALS = 500;

export default async function ReferralsPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Mints the code on first visit and returns the existing one every time after — the RPC is
  // idempotent, so there's no separate "generate my link" action for the user to take.
  const { data: code, error } = await supabase.rpc("get_or_create_referral_code");

  const { data: rows } = await supabase
    .from("referrals")
    .select("id, status, reward_points, created_at, rewarded_at")
    .eq("referrer_user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(MAX_REFERRALS);

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3400";

  return (
    <main className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-zinc-100">Referrals</h1>
        <p className="text-sm text-zinc-400">
          Invite other affiliates and earn reward points when they upgrade.
        </p>
      </header>
      {error || !code ? (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
          Could not load your referral link{error ? `: ${error.message}` : ""}. Reload to try
          again.
        </div>
      ) : (
        <ReferralPanel
          code={code as string}
          appUrl={appUrl}
          referrals={(rows ?? []) as ReferralRow[]}
        />
      )}
    </main>
  );
}
