import Link from "next/link";
import { Coins } from "lucide-react";

// Credit balance, shown in the top bar next to the bell rather than in the sidebar: it's account
// status, not navigation — the same reason the bell and the account menu live there.
export default function CreditsChip({
  creditBalance,
  className = "",
}: {
  creditBalance: number;
  className?: string;
}) {
  return (
    <Link
      href="/settings/billing"
      data-tour="credits-chip"
      title={`${creditBalance} credits — top up`}
      className={`flex items-center gap-1.5 rounded-full border border-ink-600 px-2.5 py-1 text-xs text-emerald-300 hover:border-emerald-500 ${className}`}
    >
      <Coins className="h-3.5 w-3.5 shrink-0" />
      <span>{creditBalance}</span>
      <span className="hidden sm:inline">credits</span>
    </Link>
  );
}
