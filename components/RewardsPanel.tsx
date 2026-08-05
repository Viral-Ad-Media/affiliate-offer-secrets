"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Award, Coins } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

export type RewardEntry = {
  id: string;
  delta: number;
  reason: string;
  created_at: string;
};

type Props = { balance: number; entries: RewardEntry[] };

export default function RewardsPanel({ balance, entries }: Props) {
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  async function redeem() {
    const points = Number(amount);
    if (!Number.isInteger(points) || points <= 0) {
      setMessage({ kind: "error", text: "Enter a whole number of points." });
      return;
    }
    if (points > balance) {
      setMessage({ kind: "error", text: "You don't have that many points." });
      return;
    }

    setBusy(true);
    setMessage(null);
    // redeem_rewards does the real check under an advisory lock — the guards above are UX only,
    // and a false return means the balance moved between render and click.
    const { data, error } = await createClient().rpc("redeem_rewards", { p_points: points });
    setBusy(false);

    if (error) {
      setMessage({ kind: "error", text: error.message });
      return;
    }
    if (data === false) {
      setMessage({ kind: "error", text: "Not enough points — your balance may have changed." });
      return;
    }
    setAmount("");
    setMessage({ kind: "ok", text: `Redeemed ${points} points for ${points} ad credits.` });
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-ink-700 bg-ink-900/40 p-5">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-zinc-500">
            <Award className="h-3.5 w-3.5" />
            Points balance
          </div>
          <div className="mt-1 text-3xl font-bold text-emerald-300">{balance}</div>
        </div>
        <div className="rounded-xl border border-ink-700 bg-ink-900/40 p-5">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-zinc-500">
            <Coins className="h-3.5 w-3.5" />
            Redeem for ad credits
          </div>
          <p className="mt-1 text-sm text-zinc-400">1 point = 1 ad credit.</p>
          <div className="mt-3 flex items-center gap-2">
            <input
              type="number"
              min={1}
              max={balance}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="Points"
              disabled={balance === 0 || busy}
              className="w-32 rounded-lg border border-ink-600 bg-ink-800 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 disabled:opacity-50"
            />
            <Button
              onClick={redeem}
              disabled={balance === 0 || busy} className="px-4 py-2 text-sm disabled:opacity-50">
              {busy ? "Redeeming…" : "Redeem"}
            </Button>
          </div>
          {message && (
            <p
              className={`mt-2 text-sm ${
                message.kind === "ok" ? "text-emerald-300" : "text-red-300"
              }`}
            >
              {message.text}
            </p>
          )}
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-ink-700">
        <table className="w-full text-sm">
          <thead className="bg-ink-900/60 text-left text-xs uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="px-4 py-2.5 font-medium">Date</th>
              <th className="px-4 py-2.5 font-medium">Reason</th>
              <th className="px-4 py-2.5 font-medium text-right">Points</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-700">
            {entries.length === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-8 text-center text-zinc-500">
                  No reward activity yet — refer an affiliate to earn your first points.
                </td>
              </tr>
            )}
            {entries.map((e) => (
              <tr key={e.id}>
                <td className="px-4 py-2.5 text-zinc-300">
                  {new Date(e.created_at).toLocaleDateString()}
                </td>
                <td className="px-4 py-2.5 text-zinc-400">{e.reason}</td>
                <td
                  className={`px-4 py-2.5 text-right font-medium ${
                    e.delta > 0 ? "text-emerald-300" : "text-zinc-400"
                  }`}
                >
                  {e.delta > 0 ? `+${e.delta}` : e.delta}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
