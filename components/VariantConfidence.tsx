"use client";

import { variantVerdict, describeProbability, needsMultipleComparisonsNote } from "@/lib/splitTestStats";

/**
 * "How likely is this variant to be better than the control", for one variant card.
 *
 * Shared by components/SplitTestBranch.tsx (the funnel-map branch) and components/SplitTestPanel.tsx
 * (the detailed list) for the same reason lib/useSplitTest.ts is: two views of one test that
 * disagreed about whether B is winning would be worse than either one alone.
 *
 * The control gets no figure — it IS the baseline, and "control is 50% likely to beat control" is
 * noise on every card.
 */

export type VariantStat = { id: string; is_control: boolean; views: number };

export default function VariantConfidence({
  variant,
  variants,
  leadCounts,
}: {
  variant: VariantStat;
  variants: VariantStat[];
  leadCounts: Record<string, number>;
}) {
  if (variant.is_control) {
    return <span className="text-[11px] text-zinc-600">baseline</span>;
  }

  const control = variants.find((v) => v.is_control);
  // A test with no control row shouldn't exist (start_bridge_split_test always writes one), but a
  // stats line is the wrong place to assert that — say nothing rather than render a broken chip.
  if (!control) return null;

  const verdict = variantVerdict(
    { conversions: leadCounts[variant.id] ?? 0, visitors: variant.views },
    { conversions: leadCounts[control.id] ?? 0, visitors: control.views }
  );

  if (verdict.kind === "early") {
    // Names the binding constraint rather than both, so it reads as one instruction. Visitors is
    // checked first because it's the one that usually resolves on its own with traffic.
    const need =
      verdict.needVisitors > 0
        ? `${verdict.needVisitors} more visitor${verdict.needVisitors === 1 ? "" : "s"}`
        : `${verdict.needConversions} more opt-in${verdict.needConversions === 1 ? "" : "s"}`;
    return (
      <span
        className="text-[11px] text-zinc-500"
        title="Too little data to compare yet. A rate from a handful of visitors looks identical to one from hundreds, so no figure is shown until there is enough to mean something."
      >
        Too early — needs {need}
      </span>
    );
  }

  const { label, strong, losing } = describeProbability(verdict.probability);
  const pct = Math.round(verdict.probability * 100);
  const tone = strong
    ? losing
      ? "text-red-300"
      : "text-emerald-300"
    : losing
      ? "text-zinc-400"
      : "text-zinc-300";

  return (
    <span
      className={`text-[11px] font-medium ${tone}`}
      title={`${pct}% probability this variant's true opt-in rate is higher than the control's. Not a guarantee, and not a signal to stop — it moves as more traffic arrives.`}
    >
      {pct}% to beat control · {label}
    </span>
  );
}

/**
 * The caveat that belongs under a multi-variant test.
 *
 * Each probability above is individually correct; what goes wrong is reading the BEST of several
 * as if it were the only one tested. Someone has to win the coin-tossing even when every page is
 * identical. This is a note rather than a correction because the fix is in how hard you lean on
 * the maximum, which is a judgement call, not arithmetic.
 */
export function MultipleVariantsNote({ variants }: { variants: VariantStat[] }) {
  const nonControl = variants.filter((v) => !v.is_control).length;
  if (!needsMultipleComparisonsNote(nonControl)) return null;
  return (
    <p className="mt-2 text-[11px] leading-snug text-zinc-500">
      With {nonControl} variants running, the best-looking one is flattered by chance — one of them
      tends to look good even when all the pages are the same. Treat the leader as weaker than it
      reads, or test them one at a time.
    </p>
  );
}
