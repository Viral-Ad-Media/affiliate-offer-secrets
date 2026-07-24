import { redirect } from "next/navigation";
import Link from "next/link";
import { CheckCircle2, XCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { BuyAccessButton, BuyCreditsGrid } from "@/components/BillingActions";
import LogoutButton from "@/components/LogoutButton";

export default async function BillingPage({
  searchParams,
}: {
  searchParams: { success?: string; canceled?: string };
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("access_granted")
    .eq("id", user.id)
    .single();

  const { data: creditRows } = await supabase
    .from("credits_ledger")
    .select("delta")
    .eq("user_id", user.id);
  const creditBalance = (creditRows ?? []).reduce((sum, r) => sum + r.delta, 0);

  return (
    <main className="mx-auto max-w-lg px-4 py-10">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-bold text-zinc-100">Billing</h1>
        <LogoutButton>Log out</LogoutButton>
      </div>

      {searchParams.success && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
          <CheckCircle2 className="h-4 w-4" /> Payment received — this updates within a few
          seconds.
        </div>
      )}
      {searchParams.canceled && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          <XCircle className="h-4 w-4" /> Checkout canceled.
        </div>
      )}

      {!profile?.access_granted ? (
        <div className="card p-5">
          <h2 className="mb-1 text-sm font-semibold text-zinc-100">Unlock ClickBank Studio</h2>
          <p className="mb-4 text-sm text-zinc-400">
            One-time payment for full access — discovery, campaign kits, and (once connected)
            posting and ad launches on your own accounts.
          </p>
          <BuyAccessButton />
        </div>
      ) : (
        <div className="space-y-5">
          <div className="card p-5 text-center">
            <div className="text-3xl font-bold text-emerald-400">{creditBalance}</div>
            <div className="text-xs text-zinc-500">credits available</div>
          </div>
          <div className="card p-5">
            <h2 className="mb-1 text-sm font-semibold text-zinc-100">Buy credits</h2>
            <p className="mb-4 text-sm text-zinc-400">
              1 credit ≈ $1 of ad budget the platform is authorized to launch on your own
              connected ad account. Meta bills your ad account directly for actual spend —
              credits are a spend cap, not funds held by us.
            </p>
            <BuyCreditsGrid />
          </div>
          <Link href="/" className="btn-ghost block text-center">
            Back to dashboard
          </Link>
        </div>
      )}
    </main>
  );
}
