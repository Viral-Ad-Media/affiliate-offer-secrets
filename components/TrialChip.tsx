import Link from "next/link";
import { Clock } from "lucide-react";

// Trial countdown. Lives in the top bar (centered), not the sidebar — same reasoning as
// CreditsChip: it's account status, not navigation. Centered rather than grouped with the
// credits/bell cluster because it's a deadline the operator should notice, not another control.
export default function TrialChip({
  trialDaysLeft,
  className = "",
}: {
  trialDaysLeft: number;
  className?: string;
}) {
  const label = `Trial: ${trialDaysLeft} ${trialDaysLeft === 1 ? "day" : "days"} left`;
  return (
    <Link
      href="/settings/billing"
      title={`${label} — upgrade`}
      className={`flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs text-amber-300 hover:border-amber-500 ${className}`}
    >
      <Clock className="h-3.5 w-3.5 shrink-0" />
      <span>{label}</span>
    </Link>
  );
}
