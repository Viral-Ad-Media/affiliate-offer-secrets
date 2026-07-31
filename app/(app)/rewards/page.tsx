import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import RewardsPanel, { type RewardEntry } from "@/components/RewardsPanel";

export const dynamic = "force-dynamic";

const MAX_ENTRIES = 500;

export default async function RewardsPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: rows } = await supabase
    .from("rewards_ledger")
    .select("id, delta, reason, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(MAX_ENTRIES);

  // Balance is SUM(delta) over the whole ledger, same append-only model as credits_ledger — so
  // it's computed from a separate unbounded select, not from the display-capped list above.
  const { data: allDeltas } = await supabase
    .from("rewards_ledger")
    .select("delta")
    .eq("user_id", user.id);
  const balance = (allDeltas ?? []).reduce((sum, r) => sum + r.delta, 0);

  return (
    <main className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-zinc-100">Rewards</h1>
        <p className="text-sm text-zinc-400">
          Points earned from{" "}
          <Link href="/referrals" className="text-emerald-300 hover:underline">
            referrals
          </Link>
          , redeemable for ad credits.
        </p>
      </header>
      <RewardsPanel balance={balance} entries={(rows ?? []) as RewardEntry[]} />
    </main>
  );
}
