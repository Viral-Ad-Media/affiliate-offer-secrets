"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw, XCircle, Loader2, Eye, Pencil, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { AdminProblemJob } from "@/lib/shared";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

// Jobs that need a human: terminally failed, or sitting pending/running far longer than the
// 1-minute backstop should ever allow. Both actions go straight to the self-gating RPCs — no
// wrapping API route, matching how every other RPC-only write in this app works (add_domain_route,
// claim_campaign_creative, the broadcast lifecycle). The RPC writes its audit row in the same
// breath as the effect, so there's no way to act here without leaving a trace.
export default function AdminProblemJobs({ jobs }: { jobs: AdminProblemJob[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The preview/edit dialog. `detail` is fetched on demand via admin_job_detail — payload and
  // stage_data can be tens of KB (extracted sales-page text), so the list read never carries them.
  const [inspecting, setInspecting] = useState<string | null>(null);
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);
  const [payloadDraft, setPayloadDraft] = useState("");
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function act(jobId: string, kind: "requeue" | "fail" | "delete") {
    if (kind === "fail" && !confirm("Terminally fail this job? It will not be retried.")) return;
    if (
      kind === "delete" &&
      !confirm(
        "Delete this job outright? Any credits it charged are refunded, and the job disappears from the queue and this list. There is no undo."
      )
    )
      return;
    setBusy(jobId);
    setError(null);
    const supabase = createClient();
    const { error: rpcError } =
      kind === "requeue"
        ? await supabase.rpc("admin_requeue_job", { p_job_id: jobId })
        : kind === "delete"
          ? await supabase.rpc("admin_delete_job", { p_job_id: jobId })
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

  async function openInspect(jobId: string) {
    setInspecting(jobId);
    setDetail(null);
    setDialogError(null);
    const { data, error: rpcError } = await createClient().rpc("admin_job_detail", { p_job_id: jobId });
    if (rpcError) {
      setDialogError(rpcError.message);
      return;
    }
    const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | undefined;
    if (!row) {
      setDialogError("Job not found — it may have just been deleted.");
      return;
    }
    setDetail(row);
    setPayloadDraft(JSON.stringify(row.payload ?? {}, null, 2));
  }

  async function savePayload() {
    if (!inspecting) return;
    // Parse client-side first so a typo gets a pointer to the problem instead of a DB error.
    let parsed: unknown;
    try {
      parsed = JSON.parse(payloadDraft);
    } catch (e: any) {
      setDialogError(`Not valid JSON: ${e?.message ?? e}`);
      return;
    }
    setSaving(true);
    setDialogError(null);
    const { error: rpcError } = await createClient().rpc("admin_update_job_payload", {
      p_job_id: inspecting,
      p_payload: parsed,
    });
    setSaving(false);
    if (rpcError) {
      setDialogError(rpcError.message);
      return;
    }
    setInspecting(null);
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
                        onClick={() => openInspect(j.id)}
                        disabled={busy === j.id}
                        title="Preview the job's payload, stage data and last result — and edit the payload"
                        variant="outline"
                        className="text-xs"
                      >
                        <Eye className="h-3.5 w-3.5" /> Inspect
                      </Button>
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
                      <Button
                        onClick={() => act(j.id, "delete")}
                        disabled={busy === j.id}
                        title="Delete the job outright — refunds its credits first"
                        variant="outline"
                        className="text-xs text-red-300"
                      >
                        <Trash2 className="h-3.5 w-3.5" /> Delete
                      </Button>
                    </div>
                  </td>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {/* Preview + payload editor. stage_data is read-only on purpose — the worker owns it (it is
          each stage's committed output), and hand-editing it would let a resume run on state no
          stage ever produced. The payload is the caller's input, which is exactly the thing an
          admin legitimately fixes before a requeue; the RPC refuses while the job is running and
          keeps the replaced payload in the audit trail. */}
      <Dialog open={inspecting !== null} onOpenChange={(open) => !open && setInspecting(null)}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Job details</DialogTitle>
          </DialogHeader>
          {dialogError && (
            <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {dialogError}
            </p>
          )}
          {!detail && !dialogError && (
            <p className="py-6 text-center text-sm text-zinc-500">
              <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading…
            </p>
          )}
          {detail && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-zinc-400 sm:grid-cols-3">
                <div><span className="text-zinc-500">Type</span> {String(detail.type)}</div>
                <div><span className="text-zinc-500">Status</span> {String(detail.status)}</div>
                <div><span className="text-zinc-500">Stage</span> {String(detail.stage ?? "—")}</div>
                <div><span className="text-zinc-500">Attempts</span> {String(detail.attempts)}</div>
                <div><span className="text-zinc-500">Updated</span> {new Date(String(detail.updated_at)).toLocaleString()}</div>
                <div><span className="text-zinc-500">Locked</span> {detail.locked_at ? new Date(String(detail.locked_at)).toLocaleString() : "—"}</div>
              </div>

              {typeof detail.result === "string" && detail.result && (
                <div>
                  <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">Last result</div>
                  <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded-lg bg-ink-800 p-2 text-xs text-red-300">{detail.result}</pre>
                </div>
              )}

              <div>
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  Payload <span className="normal-case text-zinc-600">— editable; refused while the job is running</span>
                </div>
                <textarea
                  value={payloadDraft}
                  onChange={(e) => setPayloadDraft(e.target.value)}
                  rows={10}
                  spellCheck={false}
                  className="w-full rounded-lg border border-ink-600 bg-ink-900 p-2 font-mono text-xs text-zinc-200 focus:outline-none focus:ring-1 focus:ring-emerald-400"
                />
                <div className="mt-2 flex items-center gap-2">
                  <Button onClick={savePayload} disabled={saving} className="text-xs">
                    {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Pencil className="h-3.5 w-3.5" />}
                    Save payload
                  </Button>
                  <span className="text-xs text-zinc-600">The replaced payload is kept in the admin audit trail.</span>
                </div>
              </div>

              <div>
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  Stage data <span className="normal-case text-zinc-600">— read-only, owned by the worker</span>
                </div>
                <pre className="max-h-56 overflow-auto rounded-lg bg-ink-800 p-2 text-xs text-zinc-400">
                  {JSON.stringify(detail.stage_data ?? {}, null, 2)}
                </pre>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
