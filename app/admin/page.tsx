import { createClient } from "@/lib/supabase/server";
import {
  Users,
  CreditCard,
  Package,
  Rocket,
  AlertTriangle,
  Clock,
  Coins,
  Globe,
} from "lucide-react";
import AdminAccountsTable from "@/components/AdminAccountsTable";
import AdminProblemJobs from "@/components/AdminProblemJobs";
import type {
  AdminAccountRow,
  AdminWorkspaceRow,
  AdminProblemJob,
  AdminActionRow,
} from "@/lib/shared";
import { Card } from "@/components/ui/card";
import { Table, TableHeader, TableBody, TableRow, TableHead } from "@/components/ui/table";

export const dynamic = "force-dynamic";
export const metadata = { title: "Superadmin" };

// Every query here is an RPC that calls assert_superadmin() as its first act, run through the
// normal RLS-scoped client. No service-role key is involved in rendering this page: the database
// itself refuses to answer a non-superadmin, so the layout's gate is defence in depth rather than
// the only thing standing between a curious tenant and everyone else's numbers.

function Tile({
  label,
  value,
  hint,
  tone = "normal",
  Icon,
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: "normal" | "warn" | "bad";
  Icon: typeof Users;
}) {
  const valueTone =
    tone === "bad" ? "text-red-300" : tone === "warn" ? "text-amber-300" : "text-zinc-100";
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
        <Icon className="h-3.5 w-3.5 text-emerald-400" /> {label}
      </div>
      <div className={`mt-2 text-2xl font-bold ${valueTone}`}>{value}</div>
      {hint && <div className="mt-1 text-xs text-zinc-500">{hint}</div>}
    </Card>
  );
}

function humanDuration(seconds: number): string {
  if (seconds <= 0) return "—";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

export default async function AdminPage() {
  const supabase = createClient();

  const [statsRes, accountsRes, workspacesRes, jobsRes, actionsRes] = await Promise.all([
    supabase.rpc("admin_platform_stats"),
    supabase.rpc("admin_accounts"),
    supabase.rpc("admin_account_workspaces"),
    supabase.rpc("admin_problem_jobs"),
    supabase.rpc("admin_recent_actions"),
  ]);

  const s = (statsRes.data ?? {}) as Record<string, number>;
  const accounts = (accountsRes.data ?? []) as AdminAccountRow[];
  const workspaces = (workspacesRes.data ?? []) as AdminWorkspaceRow[];
  const jobs = (jobsRes.data ?? []) as AdminProblemJob[];
  const actions = (actionsRes.data ?? []) as AdminActionRow[];

  const oldestPending = Number(s.oldest_pending_seconds ?? 0);
  // The queue's own health signal. A backlog is only alarming if it isn't moving — a big pending
  // count that drains in seconds is fine, one stuck row for an hour means the trigger/cron path
  // is broken. Five minutes is comfortably past the 1-minute backstop's normal worst case.
  const queueStalled = oldestPending > 300;

  return (
    <main className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-zinc-100">Superadmin</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Everything across every account, and the handful of actions worth doing by hand.
        </p>
      </div>

      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">
          Platform
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Tile
            label="Accounts"
            value={s.accounts ?? 0}
            hint={`${s.accounts_paid ?? 0} paid · ${s.accounts_trial ?? 0} on trial · ${s.accounts_expired ?? 0} lapsed`}
            Icon={Users}
          />
          <Tile
            label="Credits outstanding"
            value={s.credits_outstanding ?? 0}
            hint="Unspent ad-spend authorization across all accounts"
            Icon={Coins}
          />
          <Tile
            label="Generation spend"
            value={`$${(s.spend_total ?? 0).toFixed(2)}`}
            hint={`$${(s.spend_24h ?? 0).toFixed(2)} in the last 24h`}
            Icon={CreditCard}
          />
          <Tile
            label="Workspaces"
            value={s.workspaces ?? 0}
            hint="Shared tenant data and credit pools"
            Icon={Globe}
          />
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">
          Queue health
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Tile
            label="Oldest pending"
            value={humanDuration(oldestPending)}
            hint={queueStalled ? "Queue looks stalled — check the cron" : "Worker is keeping up"}
            tone={queueStalled ? "bad" : "normal"}
            Icon={Clock}
          />
          <Tile label="Pending" value={s.jobs_pending ?? 0} Icon={Clock} />
          <Tile label="Running" value={s.jobs_running ?? 0} Icon={Rocket} />
          <Tile
            label="Failed"
            value={s.jobs_error ?? 0}
            hint="Terminal failures, retries exhausted"
            tone={(s.jobs_error ?? 0) > 0 ? "warn" : "normal"}
            Icon={AlertTriangle}
          />
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">
          Output
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Tile label="Products tracked" value={s.products ?? 0} Icon={Package} />
          <Tile label="Campaign kits ready" value={s.campaigns_ready ?? 0} Icon={Package} />
          <Tile label="Funnels live" value={s.funnels_live ?? 0} Icon={Globe} />
          <Tile
            label="Leads captured"
            value={s.contacts ?? 0}
            hint={`${s.ad_launches ?? 0} ad launches`}
            Icon={Users}
          />
        </div>
      </section>

      <AdminProblemJobs jobs={jobs} />

      <AdminAccountsTable accounts={accounts} workspaces={workspaces} />

      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">
          Recent admin actions
        </h2>
        {actions.length === 0 ? (
          <p className="text-sm text-zinc-500">Nothing yet.</p>
        ) : (
          <Card className="overflow-x-auto">
            <Table className="w-full">
              <TableHeader>
                <tr>
                  <TableHead edge>When</TableHead>
                  <TableHead>Actor</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Target</TableHead>
                  <TableHead edge>Detail</TableHead>
                </tr>
              </TableHeader>
              <TableBody>
                {actions.map((a) => (
                  <TableRow key={a.id}>
                    <td className="whitespace-nowrap text-zinc-500">
                      {new Date(a.created_at).toLocaleString()}
                    </td>
                    <td className="text-zinc-400">{a.actor_email ?? "—"}</td>
                    <td className="text-zinc-100">{a.action}</td>
                    <td className="text-zinc-400">{a.target_email ?? "—"}</td>
                    <td className="max-w-xs truncate text-xs text-zinc-500" title={JSON.stringify(a.detail)}>
                      {JSON.stringify(a.detail)}
                    </td>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )}
      </section>
    </main>
  );
}
