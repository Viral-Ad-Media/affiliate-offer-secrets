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
    <Card as="section" className="flex flex-wrap items-center gap-2 p-3">
      {/* A chip strip, not a row list — explicit request: the row version cost ~64px per item and
          regularly pushed the stats below the fold. Each chip is still a real link; the longer
          detail line lives in the title tooltip instead of a second row of text. */}
      <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
        <Clock className="h-3.5 w-3.5 text-emerald-400" /> Needs attention
      </span>
      {items.map((it) => (
        <Link
          key={it.key}
          href={it.href}
          title={it.detail}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors",
            it.tone === "warn"
              ? "border-amber-500/30 bg-amber-500/10 text-amber-300 hover:border-amber-400"
              : "border-ink-600 text-zinc-300 hover:border-emerald-500/50 hover:text-emerald-300"
          )}
        >
          {it.tone === "warn" && <AlertTriangle className="h-3 w-3" />}
          <span className="font-semibold tabular-nums">{it.count}</span>
          {it.label}
          <ArrowRight className="h-3 w-3 opacity-50" aria-hidden />
        </Link>
      ))}
    </Card>
  );
}
