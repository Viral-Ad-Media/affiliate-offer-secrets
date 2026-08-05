"use client";

import { useState } from "react";
import { Check, Copy, Gift } from "lucide-react";
import { referralLink, REFERRAL_REWARD_POINTS } from "@/lib/referrals";
import { Badge } from "@/components/ui/badge";

export type ReferralRow = {
  id: string;
  status: "pending" | "rewarded";
  reward_points: number;
  created_at: string;
  rewarded_at: string | null;
};

type Props = { code: string; appUrl: string; referrals: ReferralRow[] };

export default function ReferralPanel({ code, appUrl, referrals }: Props) {
  const [copied, setCopied] = useState(false);
  const link = referralLink(appUrl, code);

  function copy() {
    navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const rewarded = referrals.filter((r) => r.status === "rewarded");
  const pointsEarned = rewarded.reduce((sum, r) => sum + r.reward_points, 0);

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-ink-700 bg-ink-900/40 p-5">
        <div className="flex items-center gap-2 text-sm font-medium text-zinc-200">
          <Gift className="h-4 w-4 text-emerald-400" />
          Your referral link
        </div>
        <p className="mt-1 text-sm text-zinc-400">
          Share this link. When someone signs up through it and pays for access, you earn{" "}
          <span className="text-emerald-300">{REFERRAL_REWARD_POINTS} reward points</span> —
          redeemable 1:1 for ad credits on the Rewards page.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-lg border border-ink-600 bg-ink-800 px-3 py-2 text-sm text-zinc-200">
            {link}
          </code>
          <button
            onClick={copy}
            className="flex items-center gap-1.5 rounded-lg border border-ink-600 px-3 py-2 text-sm text-zinc-300 hover:border-emerald-500 hover:text-emerald-300"
          >
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Signups referred" value={referrals.length} />
        <Stat label="Paid & rewarded" value={rewarded.length} />
        <Stat label="Points earned" value={pointsEarned} accent />
      </div>

      <div className="overflow-hidden rounded-xl border border-ink-700">
        <table className="w-full text-sm">
          <thead className="bg-ink-900/60 text-left text-xs uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="px-4 py-2.5 font-medium">Signed up</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
              <th className="px-4 py-2.5 font-medium">Points</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-700">
            {referrals.length === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-8 text-center text-zinc-500">
                  No referrals yet — share your link to get started.
                </td>
              </tr>
            )}
            {referrals.map((r) => (
              <tr key={r.id}>
                <td className="px-4 py-2.5 text-zinc-300">
                  {new Date(r.created_at).toLocaleDateString()}
                </td>
                <td className="px-4 py-2.5">
                  {r.status === "rewarded" ? (
                    <Badge className="border-emerald-500/30 bg-emerald-500/10 text-emerald-300">
                      Rewarded
                    </Badge>
                  ) : (
                    <Badge className="border-ink-600 bg-ink-800 text-zinc-400">
                      Awaiting payment
                    </Badge>
                  )}
                </td>
                <td className="px-4 py-2.5 text-zinc-300">
                  {r.status === "rewarded" ? `+${r.reward_points}` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* Deliberately no email/name column: referred accounts are other people, and showing their
          address to whoever shared a link would leak PII the referrer never needs. */}
      <p className="text-xs text-zinc-500">
        Referred accounts are shown by signup date only — never by name or email.
      </p>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className="rounded-xl border border-ink-700 bg-ink-900/40 p-4">
      <div className="text-xs uppercase tracking-wide text-zinc-500">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${accent ? "text-emerald-300" : "text-zinc-100"}`}>
        {value}
      </div>
    </div>
  );
}
