"use client";

import { useState } from "react";
import { RefreshCw, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/lib/toast";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableHeader, TableBody, TableRow, TableHead } from "@/components/ui/table";

export type TrialPipelineRow = {
  user_id: string;
  email: string;
  trial_ends_at: string | null;
  has_card: boolean;
  card_label: string | null;
  conversion_status: string; // not_due | pending | succeeded | failed | abandoned
  attempts: number;
  next_attempt_at: string | null;
  last_error: string | null;
};

const STATUS_STYLE: Record<string, string> = {
  not_due: "border-ink-600 bg-ink-800 text-zinc-400",
  pending: "border-sky-500/30 bg-sky-500/15 text-sky-300",
  failed: "border-amber-500/30 bg-amber-500/15 text-amber-300",
  abandoned: "border-red-500/30 bg-red-500/15 text-red-300",
  succeeded: "border-emerald-500/30 bg-emerald-500/15 text-emerald-300",
};

/**
 * Every unpaid account and where its charge stands — the read surface for 0104's dunning state,
 * which is otherwise service-role-only and invisible.
 *
 * The one action is "Retry charge", and only on failed/abandoned rows: retrying a charge that
 * hasn't been attempted yet would just charge early, and the RPC deliberately resets the dunning
 * row for the SWEEP to pick up rather than charging here — one code path creates PaymentIntents.
 */
export default function AdminTrialPipeline({ rows }: { rows: TrialPipelineRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  async function retry(row: TrialPipelineRow) {
    setBusy(row.user_id);
    const { error } = await createClient().rpc("admin_retry_trial_charge", {
      p_user_id: row.user_id,
      p_reason: "manual retry from admin dashboard",
    });
    setBusy(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`${row.email} queued — the sweep will charge on its next run`);
    router.refresh();
  }

  return (
    <section>
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">
        Trial pipeline
      </h2>
      {rows.length === 0 ? (
        <p className="text-sm text-zinc-500">Everyone has paid — nothing in the pipeline.</p>
      ) : (
        <Card className="overflow-x-auto">
          <Table className="w-full text-sm">
            <TableHeader>
              <tr>
                <TableHead edge>Account</TableHead>
                <TableHead>Trial ends</TableHead>
                <TableHead>Card</TableHead>
                <TableHead>Charge</TableHead>
                <TableHead>Last error</TableHead>
                <TableHead edge className="text-right">Actions</TableHead>
              </tr>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const over = r.trial_ends_at && new Date(r.trial_ends_at) <= new Date();
                return (
                  <TableRow key={r.user_id}>
                    <td className="px-4 py-2.5 text-zinc-100">{r.email}</td>
                    <td className={`px-2 py-2.5 whitespace-nowrap ${over ? "text-amber-300" : "text-zinc-400"}`}>
                      {r.trial_ends_at ? new Date(r.trial_ends_at).toLocaleDateString() : "—"}
                      {over ? " · ended" : ""}
                    </td>
                    <td className="px-2 py-2.5 text-zinc-400">
                      {r.has_card ? (r.card_label ?? "on file") : <span className="text-red-300">none</span>}
                    </td>
                    <td className="px-2 py-2.5">
                      <Badge className={STATUS_STYLE[r.conversion_status] ?? STATUS_STYLE.not_due}>
                        {r.conversion_status === "not_due" ? "not due" : r.conversion_status}
                        {r.attempts > 0 ? ` · ${r.attempts}` : ""}
                      </Badge>
                    </td>
                    <td className="max-w-xs truncate px-2 py-2.5 text-xs text-zinc-500" title={r.last_error ?? undefined}>
                      {r.last_error ?? "—"}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {(r.conversion_status === "failed" || r.conversion_status === "abandoned") && (
                        <Button
                          variant="outline"
                          className="!py-1 text-xs"
                          disabled={busy === r.user_id}
                          onClick={() => retry(r)}
                        >
                          {busy === r.user_id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <RefreshCw className="h-3.5 w-3.5" />
                          )}
                          Retry charge
                        </Button>
                      )}
                    </td>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}
    </section>
  );
}
