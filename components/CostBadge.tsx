"use client";

import { Coins } from "lucide-react";
import Link from "next/link";
import { creditCostFor, formatCost } from "@/lib/credits";
import { useCredits } from "@/components/CreditsProvider";

/**
 * The price of an action, shown next to the button that triggers it.
 *
 * Deliberately a HINT, never a gate: it never disables anything itself. The server re-checks the
 * balance inside charge_job_credits under an advisory lock and answers 402, which is the only
 * answer that can be trusted — a client-side block computed from a possibly-stale number would
 * either lie about affordability or, worse, grey out a button that would actually have worked.
 * What this does buy is that nobody clicks a generate button without knowing it costs 10 credits.
 */
export default function CostBadge({
  jobType,
  className = "",
}: {
  jobType: string;
  className?: string;
}) {
  const cost = creditCostFor(jobType);
  const { canAfford } = useCredits();

  if (cost <= 0) return null;

  const affordable = canAfford(cost);

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[12px] font-medium ${
        affordable ? "bg-ink-700 text-zinc-300" : "bg-amber-500/15 text-amber-300"
      } ${className}`}
      title={
        affordable
          ? `Costs ${formatCost(cost)}`
          : `Costs ${formatCost(cost)} — you don't have enough credits`
      }
    >
      <Coins className="h-3 w-3" />
      {cost}
      {!affordable && (
        <Link href="/settings/billing" className="underline underline-offset-2">
          top up
        </Link>
      )}
    </span>
  );
}
