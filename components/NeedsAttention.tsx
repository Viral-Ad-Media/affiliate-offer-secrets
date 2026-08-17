import Link from "next/link";
import { AlertTriangle, ArrowRight, CheckCircle2, Clock } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { AttentionItem } from "@/lib/overview";

/**
 * The action queue — the answer to "what should I do right now".
 *
 * Built because finished work was invisible until you went looking for it: 40 generated ad angles
 * and 14 draft email sequences were sitting ready with nothing on any page saying so, and two
 * terminally-failed video jobs could only be found through SQL.
 *
 * Problems (`warn`) sort above unshipped work (`todo`) because one means something is broken and
 * the other means something is merely waiting. Both are actionable; only one is wrong.
 *
 * The all-clear state is a real state, not an absence — a queue that renders nothing when empty
 * reads as "still loading" or "broken" rather than "you're done".
 */
export default function NeedsAttention({ items }: { items: AttentionItem[] }) {
  if (items.length === 0) {
    return (
      <Card as="section" className="flex items-center gap-3 p-4">
        <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-400" aria-hidden />
        <div>
          <p className="text-sm font-semibold text-zinc-100">Nothing waiting</p>
          <p className="text-xs text-zinc-500">
            No failed jobs, and nothing generated is sitting unpublished.
          </p>
        </div>
      </Card>
    );
  }

  const problems = items.filter((i) => i.tone === "warn").length;

  return (
    <Card as="section" className="overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-700 px-4 py-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
          <Clock className="h-4 w-4 text-emerald-400" /> Needs attention
        </h2>
        {problems > 0 && (
          <span className="text-xs text-amber-300">
            {problems} {problems === 1 ? "problem" : "problems"}
          </span>
        )}
      </header>

      <ul className="divide-y divide-ink-700">
        {items.map((it) => (
          <li key={it.key}>
            <Link
              href={it.href}
              className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-ink-800/60"
            >
              <span
                className={cn(
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sm font-bold",
                  it.tone === "warn"
                    ? "bg-amber-500/15 text-amber-300"
                    : "bg-emerald-500/10 text-emerald-300"
                )}
              >
                {it.tone === "warn" ? <AlertTriangle className="h-4 w-4" /> : it.count}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-zinc-100">
                  {it.tone === "warn" ? `${it.count} ` : ""}
                  {it.label}
                </p>
                <p className="truncate text-xs text-zinc-500">{it.detail}</p>
              </div>
              <ArrowRight className="h-4 w-4 shrink-0 text-zinc-600" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
