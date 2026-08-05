import type { UsageEntry } from "@/lib/shared";
import { Card } from "@/components/ui/card";

function formatCost(usd: number): string {
  if (usd === 0) return "$0.00";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

const JOB_TYPE_LABELS: Record<string, string> = {
  discover_products: "Discovery",
  build_campaign: "Campaign kit",
};

export default function UsageLedger({
  entries,
  totalCostUsd,
}: {
  entries: UsageEntry[];
  totalCostUsd: number;
}) {
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-ink-700 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-zinc-100">Resource usage</h2>
          <p className="text-xs text-zinc-500">
            Exact Anthropic API cost for every discovery and campaign-kit job run on your account.
          </p>
        </div>
        <div className="text-right">
          <div className="text-lg font-bold text-emerald-400">{formatCost(totalCostUsd)}</div>
          <div className="text-xs text-zinc-500">total to date</div>
        </div>
      </div>
      <div className="max-h-80 overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-ink-900">
            <tr className="border-b border-ink-700 text-left text-xs uppercase tracking-wide text-zinc-500">
              <th className="px-4 py-2">When</th>
              <th className="px-2 py-2">Job</th>
              <th className="px-2 py-2">Stage</th>
              <th className="px-2 py-2 text-right">Tokens (in/out)</th>
              <th className="px-4 py-2 text-right">Cost</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id} className="border-b border-ink-800">
                <td className="px-4 py-2 text-xs text-zinc-500">
                  {new Date(e.created_at).toLocaleString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </td>
                <td className="px-2 py-2 text-zinc-300">
                  {JOB_TYPE_LABELS[e.job_type] ?? e.job_type}
                </td>
                <td className="px-2 py-2 text-xs text-zinc-500">{e.stage}</td>
                <td className="px-2 py-2 text-right tabular-nums text-zinc-400">
                  {e.input_tokens.toLocaleString()} / {e.output_tokens.toLocaleString()}
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-zinc-200">
                  {formatCost(e.cost_usd)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
