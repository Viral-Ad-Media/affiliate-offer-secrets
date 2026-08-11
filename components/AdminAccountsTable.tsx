"use client";

import { Fragment, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ShieldCheck, Clock, Coins, Check, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { AdminAccountRow, AdminWorkspaceRow } from "@/lib/shared";
import { hasAppAccess } from "@/lib/shared";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead } from "@/components/ui/table";

// One row per account with the numbers a support question starts from, plus the three actions
// worth doing by hand. Every action is a self-gating RPC that writes its own audit row — see
// 0055_superadmin.sql. Credit adjustment in particular is the one sanctioned exception to "only
// the Stripe webhook writes credits_ledger", which is why it insists on a reason.
export default function AdminAccountsTable({
  accounts,
  workspaces,
}: {
  accounts: AdminAccountRow[];
  workspaces: AdminWorkspaceRow[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [creditDelta, setCreditDelta] = useState("");
  const [creditReason, setCreditReason] = useState("");
  const [trialDays, setTrialDays] = useState("14");
  const [workspaceSelections, setWorkspaceSelections] = useState<Record<string, string>>({});

  const workspacesByUser = useMemo(() => {
    const grouped = new Map<string, AdminWorkspaceRow[]>();
    for (const workspace of workspaces) {
      const rows = grouped.get(workspace.user_id) ?? [];
      rows.push(workspace);
      grouped.set(workspace.user_id, rows);
    }
    return grouped;
  }, [workspaces]);

  function selectedWorkspace(userId: string): AdminWorkspaceRow | null {
    const rows = workspacesByUser.get(userId) ?? [];
    const selectedId = workspaceSelections[userId];
    return (
      rows.find((workspace) => workspace.workspace_id === selectedId) ??
      rows.find((workspace) => workspace.is_active) ??
      rows.find((workspace) => workspace.role === "owner") ??
      rows[0] ??
      null
    );
  }

  async function run(userId: string, fn: () => PromiseLike<{ error: { message: string } | null }>) {
    setBusy(userId);
    setError(null);
    const { error: rpcError } = await fn();
    setBusy(null);
    if (rpcError) {
      setError(rpcError.message);
      return false;
    }
    router.refresh();
    return true;
  }

  async function toggleAccess(a: AdminAccountRow) {
    const granting = !a.access_granted;
    if (
      !confirm(
        granting
          ? `Grant paid access to ${a.email}?`
          : `Revoke paid access from ${a.email}? They'll fall back to their trial, if any.`
      )
    )
      return;
    const supabase = createClient();
    await run(a.user_id, () =>
      supabase.rpc("admin_set_access", {
        p_user_id: a.user_id,
        p_granted: granting,
        p_reason: granting ? "granted from admin" : "revoked from admin",
      })
    );
  }

  async function adjustCredits(a: AdminAccountRow) {
    const workspace = selectedWorkspace(a.user_id);
    if (!workspace) {
      setError("This account does not belong to a workspace, so it has no credit pool to adjust.");
      return;
    }
    const delta = Number(creditDelta);
    if (!Number.isInteger(delta) || delta === 0) {
      setError("Credit change must be a non-zero whole number (negative to claw back).");
      return;
    }
    if (!creditReason.trim()) {
      setError("A reason is required — it goes on the ledger entry and the audit row.");
      return;
    }
    const supabase = createClient();
    const ok = await run(a.user_id, () =>
      supabase.rpc("admin_adjust_workspace_credits", {
        p_target_user_id: a.user_id,
        p_workspace_id: workspace.workspace_id,
        p_delta: delta,
        p_reason: creditReason.trim(),
      })
    );
    if (ok) {
      setCreditDelta("");
      setCreditReason("");
      setOpen(null);
    }
  }

  async function extendTrial(a: AdminAccountRow) {
    const days = Number(trialDays);
    if (!Number.isInteger(days) || days === 0) {
      setError("Trial change must be a non-zero whole number of days.");
      return;
    }
    const supabase = createClient();
    const ok = await run(a.user_id, () =>
      supabase.rpc("admin_extend_trial", { p_user_id: a.user_id, p_days: days })
    );
    if (ok) setOpen(null);
  }

  function accessLabel(a: AdminAccountRow) {
    if (a.access_granted) return { text: "Paid", cls: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" };
    if (hasAppAccess({ access_granted: a.access_granted, trial_ends_at: a.trial_ends_at })) {
      const days = Math.ceil(
        (new Date(a.trial_ends_at!).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
      );
      return { text: `Trial · ${days}d`, cls: "border-amber-500/30 bg-amber-500/10 text-amber-300" };
    }
    return { text: "No access", cls: "border-zinc-500/30 bg-zinc-500/10 text-zinc-400" };
  }

  return (
    <section>
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">
        Accounts ({accounts.length})
      </h2>

      {error && (
        <p className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}

      <Card className="overflow-x-auto">
        <Table className="w-full">
          <TableHeader>
            <tr>
              <TableHead edge>Account</TableHead>
              <TableHead>Access</TableHead>
              <TableHead>Workspace</TableHead>
              <TableHead className="text-right">Credits</TableHead>
              <TableHead className="text-right">Products</TableHead>
              <TableHead className="text-right">Kits</TableHead>
              <TableHead className="text-right">Leads</TableHead>
              <TableHead className="text-right">Failed jobs</TableHead>
              <TableHead className="text-right">Spend</TableHead>
              <TableHead>Last seen</TableHead>
              <TableHead edge className="text-right">Manage</TableHead>
            </tr>
          </TableHeader>
          <TableBody>
            {accounts.map((a) => {
              const badge = accessLabel(a);
              const accountWorkspaces = workspacesByUser.get(a.user_id) ?? [];
              const workspace = selectedWorkspace(a.user_id);
              return (
                <Fragment key={a.user_id}>
                  <TableRow>
                    <td>
                      <div className="flex items-center gap-2">
                        <span className="text-zinc-100">{a.full_name ?? a.email}</span>
                        {a.is_superadmin && (
                          <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" aria-label="Superadmin" />
                        )}
                      </div>
                      {a.full_name && <div className="text-xs text-zinc-500">{a.email}</div>}
                    </td>
                    <td>
                      <Badge className={badge.cls}>{badge.text}</Badge>
                    </td>
                    <td>
                      {workspace ? (
                        <select
                          aria-label={`Workspace for ${a.email}`}
                          value={workspace.workspace_id}
                          onChange={(event) =>
                            setWorkspaceSelections((current) => ({
                              ...current,
                              [a.user_id]: event.target.value,
                            }))
                          }
                          className="max-w-48 rounded-lg border border-ink-600 bg-ink-900 px-2 py-1.5 text-xs text-zinc-200 outline-none focus:border-emerald-500"
                        >
                          {accountWorkspaces.map((option) => (
                            <option key={option.workspace_id} value={option.workspace_id}>
                              {option.workspace_name} · {option.role}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="text-xs text-zinc-600">No workspace</span>
                      )}
                    </td>
                    <td className="text-right text-zinc-300">{workspace?.credits ?? "—"}</td>
                    <td className="text-right text-zinc-400">{workspace?.products ?? "—"}</td>
                    <td className="text-right text-zinc-400">{workspace?.campaigns ?? "—"}</td>
                    <td className="text-right text-zinc-400">{workspace?.contacts ?? "—"}</td>
                    <td className={`text-right ${(workspace?.jobs_error ?? 0) > 0 ? "text-red-300" : "text-zinc-500"}`}>
                      {workspace?.jobs_error ?? "—"}
                    </td>
                    <td className="text-right text-zinc-400">${a.spend_usd.toFixed(2)}</td>
                    <td className="whitespace-nowrap text-xs text-zinc-500">
                      {a.last_sign_in_at ? new Date(a.last_sign_in_at).toLocaleDateString() : "never"}
                    </td>
                    <td className="whitespace-nowrap text-right">
                      <Button
                        onClick={() => setOpen(open === a.user_id ? null : a.user_id)} variant="outline" className="text-xs">
                        {open === a.user_id ? "Close" : "Manage"}
                      </Button>
                    </td>
                  </TableRow>

                  {open === a.user_id && (
                    <TableRow>
                      <td colSpan={11} className="bg-ink-900/60">
                        <div className="flex flex-wrap items-end gap-6 p-4">
                          <div>
                            <div className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-500">
                              Access
                            </div>
                            <Button
                              onClick={() => toggleAccess(a)}
                              disabled={busy === a.user_id} variant="outline" className="text-xs">
                              {busy === a.user_id ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : a.access_granted ? (
                                <X className="h-3.5 w-3.5" />
                              ) : (
                                <Check className="h-3.5 w-3.5" />
                              )}
                              {a.access_granted ? "Revoke paid access" : "Grant paid access"}
                            </Button>
                          </div>

                          <div>
                            <div className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-500">
                              Credits
                            </div>
                            <div className="mb-2 max-w-80 truncate text-xs text-zinc-400">
                              {workspace
                                ? `${workspace.workspace_name} · ${workspace.credits} available`
                                : "No workspace credit pool"}
                            </div>
                            <div className="flex items-end gap-2">
                              <input
                                value={creditDelta}
                                onChange={(e) => setCreditDelta(e.target.value)}
                                placeholder="±25"
                                className="w-20 rounded-lg border border-ink-600 bg-ink-900 px-2 py-1.5 text-sm outline-none focus:border-emerald-500"
                              />
                              <input
                                value={creditReason}
                                onChange={(e) => setCreditReason(e.target.value)}
                                placeholder="Reason (required)"
                                className="w-56 rounded-lg border border-ink-600 bg-ink-900 px-2 py-1.5 text-sm outline-none focus:border-emerald-500"
                              />
                              <Button
                                onClick={() => adjustCredits(a)}
                                disabled={busy === a.user_id || !workspace} variant="outline" className="text-xs">
                                <Coins className="h-3.5 w-3.5" /> Apply
                              </Button>
                            </div>
                          </div>

                          <div>
                            <div className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-500">
                              Trial
                            </div>
                            <div className="flex items-end gap-2">
                              <input
                                value={trialDays}
                                onChange={(e) => setTrialDays(e.target.value)}
                                placeholder="14"
                                className="w-20 rounded-lg border border-ink-600 bg-ink-900 px-2 py-1.5 text-sm outline-none focus:border-emerald-500"
                              />
                              <Button
                                onClick={() => extendTrial(a)}
                                disabled={busy === a.user_id} variant="outline" className="text-xs">
                                <Clock className="h-3.5 w-3.5" /> Add days
                              </Button>
                            </div>
                          </div>
                        </div>
                      </td>
                    </TableRow>
                  )}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      </Card>
    </section>
  );
}
