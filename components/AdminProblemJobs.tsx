"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw, XCircle, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { AdminProblemJob } from "@/lib/shared";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead } from "@/components/ui/table";

// Jobs that need a human: terminally failed, or sitting pending/running far longer than the
// 1-minute backstop should ever allow. Both actions go straight to the self-gating RPCs — no
// wrapping API route, matching how every other RPC-only write in this app works (add_domain_route,
// claim_campaign_creative, the broadcast lifecycle). The RPC writes its audit row in the same
// breath as the effect, so there's no way to act here without leaving a trace.
export default function AdminProblemJobs({ jobs }: { jobs: AdminProblemJob[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(jobId: string, kind: "requeue" | "fail") {
    if (kind === "fail" && !confirm("Terminally fail this job? It will not be retried.")) return;
    setBusy(jobId);
    setError(null);
    const supabase = createClient();
    const { error: rpcError } =
      kind === "requeue"
        ? await supabase.rpc("admin_requeue_job", { p_job_id: jobId })
        : await supabase.rpc("admin_fail_job", {
            p_job_id: jobId,
            p_message: "failed by an administrator",
          });
    setBusy(null);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    router.refresh();
  }

  return (
    <section>
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">
        Jobs needing attention
      </h2>

      {error && (
        <p className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}

      {jobs.length === 0 ? (
        <p className="text-sm text-zinc-500">
          Nothing failed, stuck or backed up. The queue is healthy.
        </p>
      ) : (
        <Card className="overflow-x-auto">
          <Table className="w-full">
            <TableHeader>
              <tr>
                <TableHead edge>Account</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Stage</TableHead>
                <TableHead>Tries</TableHead>
                <TableHead>Last message</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead edge className="text-right">Actions</TableHead>
              </tr>
            </TableHeader>
            <TableBody>
              {jobs.map((j) => (
                <TableRow key={j.id}>
                  <td className="whitespace-nowrap text-zinc-300">{j.email}</td>
                  <td className="whitespace-nowrap text-zinc-400">{j.type}</td>
                  <td>
                    <Badge
                      className={
                        j.status === "error"
                          ? "border-red-500/30 bg-red-500/10 text-red-300"
                          : "border-amber-500/30 bg-amber-500/10 text-amber-300"
                      }>
                      {j.status}
                    </Badge>
                  </td>
                  <td className="text-zinc-500">{j.stage ?? "—"}</td>
                  <td className="text-zinc-500">{j.attempts}</td>
                  <td className="max-w-sm truncate text-xs text-zinc-500" title={j.result ?? ""}>
                    {j.result ?? "—"}
                  </td>
                  <td className="whitespace-nowrap text-xs text-zinc-500">
                    {new Date(j.updated_at).toLocaleString()}
                  </td>
                  <td className="whitespace-nowrap text-right">
                    <div className="inline-flex gap-2">
                      <Button
                        onClick={() => act(j.id, "requeue")}
                        disabled={busy === j.id}
                        
                        title="Put back in the queue — resumes from the stage it died on" variant="outline" className="text-xs">
                        {busy === j.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <RotateCcw className="h-3.5 w-3.5" />
                        )}
                        Requeue
                      </Button>
                      {j.status !== "error" && (
                        <Button
                          onClick={() => act(j.id, "fail")}
                          disabled={busy === j.id}
                          
                          title="Stop retrying this job" variant="outline" className="text-xs text-red-300">
                          <XCircle className="h-3.5 w-3.5" /> Fail
                        </Button>
                      )}
                    </div>
                  </td>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </section>
  );
}
