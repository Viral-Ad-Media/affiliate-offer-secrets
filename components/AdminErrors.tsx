"use client";

import { useState } from "react";
import { AlertTriangle, Check, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export type AdminErrorGroup = {
  fingerprint: string;
  source: string;
  level: "error" | "warning";
  latest_message: string;
  total: number;
  unresolved: number;
  first_seen: string;
  last_seen: string;
};

// Superadmin error monitor (0118). Reads pre-fetched groups from the server page; resolving a group
// calls the SECURITY DEFINER RPC through the RLS client (which enforces assert_superadmin) and drops
// the row from view. Grouped by fingerprint so one recurring failure is one line with a count, not a
// scrolling wall — the whole reason error_events stores a fingerprint.
export default function AdminErrors({ groups: initial }: { groups: AdminErrorGroup[] }) {
  const [groups, setGroups] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);

  async function resolve(fingerprint: string) {
    setBusy(fingerprint);
    const { error } = await createClient().rpc("admin_resolve_error_group", { p_fingerprint: fingerprint });
    setBusy(null);
    if (!error) setGroups((g) => g.filter((x) => x.fingerprint !== fingerprint));
  }

  const unresolved = groups.filter((g) => g.unresolved > 0);

  if (groups.length === 0) {
    return (
      <p className="rounded-lg border border-ink-700 bg-ink-900 p-4 text-sm text-zinc-500">
        No errors recorded. Terminal job failures and other captured server errors show up here.
      </p>
    );
  }

  const fmt = (iso: string) => {
    const d = new Date(iso);
    const mins = Math.round((Date.now() - d.getTime()) / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
    return `${Math.round(mins / 1440)}d ago`;
  };

  return (
    <div className="space-y-3">
      {unresolved.length > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-300">
          <AlertTriangle className="h-4 w-4" />
          {unresolved.length} unresolved error {unresolved.length === 1 ? "group" : "groups"}
        </div>
      )}
      <div className="overflow-x-auto rounded-lg border border-ink-700">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-ink-700 text-left text-[11px] uppercase tracking-wide text-zinc-500">
              <th className="px-3 py-2 font-medium">Source</th>
              <th className="px-3 py-2 font-medium">Latest message</th>
              <th className="px-3 py-2 text-right font-medium">Count</th>
              <th className="px-3 py-2 font-medium">Last seen</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <tr key={g.fingerprint} className={`border-b border-ink-800 ${g.unresolved === 0 ? "opacity-50" : ""}`}>
                <td className="whitespace-nowrap px-3 py-2">
                  <span
                    className={`mr-1.5 inline-block h-2 w-2 rounded-full ${
                      g.level === "error" ? "bg-red-400" : "bg-amber-300"
                    }`}
                  />
                  <span className="font-mono text-[12px] text-zinc-300">{g.source}</span>
                </td>
                <td className="max-w-md px-3 py-2">
                  <span className="line-clamp-2 text-zinc-300" title={g.latest_message}>
                    {g.latest_message}
                  </span>
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-zinc-400">
                  {g.total}
                  {g.unresolved > 0 && g.unresolved < g.total && (
                    <span className="text-zinc-600"> ({g.unresolved} new)</span>
                  )}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-zinc-500">{fmt(g.last_seen)}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right">
                  {g.unresolved > 0 ? (
                    <button
                      type="button"
                      onClick={() => resolve(g.fingerprint)}
                      disabled={busy === g.fingerprint}
                      className="inline-flex items-center gap-1 rounded-md border border-ink-600 px-2 py-1 text-xs text-zinc-300 hover:border-ink-500 hover:text-zinc-100 disabled:opacity-50"
                    >
                      {busy === g.fingerprint ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                      Resolve
                    </button>
                  ) : (
                    <span className="text-[11px] text-zinc-600">resolved</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
