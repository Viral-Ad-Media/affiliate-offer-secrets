"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus, Loader2, Send } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { BroadcastSequence } from "@/lib/shared";

const STATUS_COLORS: Record<string, string> = {
  draft: "border-ink-600 bg-ink-800 text-zinc-400",
  active: "border-emerald-500/30 bg-emerald-500/15 text-emerald-300",
  paused: "border-amber-500/30 bg-amber-500/15 text-amber-300",
};

const AUDIENCE_LABELS: Record<string, string> = {
  campaign: "Campaign contacts",
  all: "All contacts",
  manual: "Manual selection",
};

type Row = {
  sequence: BroadcastSequence;
  campaignTitle: string | null;
  stepCount: number;
  enrolledCount: number;
};

export default function BroadcastSequenceList({
  rows,
  campaignOptions,
}: {
  rows: Row[];
  campaignOptions: { id: string; title: string }[];
}) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [audienceType, setAudienceType] = useState<"campaign" | "all" | "manual">("campaign");
  const [campaignId, setCampaignId] = useState(campaignOptions[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setBusy(true);
    setError(null);
    const { data, error: err } = await createClient().rpc("create_broadcast_sequence", {
      p_name: name,
      p_audience_type: audienceType,
      p_campaign_id: audienceType === "campaign" ? campaignId || null : null,
    });
    setBusy(false);
    if (err || !data) {
      setError(err?.message ?? "Failed to create sequence");
      return;
    }
    router.push(`/broadcast/${data}`);
  }

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between border-b border-ink-700 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-zinc-100">Sequences</h2>
          <p className="text-xs text-zinc-500">Named drip sequences, each with its own audience and steps.</p>
        </div>
        <button onClick={() => setCreating((v) => !v)} className="btn-ghost !py-1.5 text-xs">
          <Plus className="h-3.5 w-3.5" /> New sequence
        </button>
      </div>

      {creating && (
        <div className="border-b border-ink-700 bg-ink-800/40 px-4 py-3">
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-400">Name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Woodworking welcome series"
                className="w-64 rounded-lg border border-ink-600 bg-ink-900 px-3 py-2 text-sm outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-400">Audience</label>
              <select
                value={audienceType}
                onChange={(e) => setAudienceType(e.target.value as any)}
                className="rounded-lg border border-ink-600 bg-ink-900 py-2 px-3 text-sm outline-none focus:border-emerald-500"
              >
                <option value="campaign">This campaign's contacts</option>
                <option value="all">All contacts</option>
                <option value="manual">Pick contacts manually</option>
              </select>
            </div>
            {audienceType === "campaign" && (
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-400">Campaign</label>
                <select
                  value={campaignId}
                  onChange={(e) => setCampaignId(e.target.value)}
                  className="rounded-lg border border-ink-600 bg-ink-900 py-2 px-3 text-sm outline-none focus:border-emerald-500"
                >
                  {campaignOptions.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <button
              onClick={create}
              disabled={busy || !name.trim() || (audienceType === "campaign" && !campaignId)}
              className="btn-primary"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Create
            </button>
          </div>
          {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
        </div>
      )}

      {rows.length === 0 ? (
        <p className="px-4 py-10 text-center text-sm text-zinc-500">
          No sequences yet — create one to start sending automated emails to your captured leads.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="data-table w-full text-sm">
            <thead>
              <tr>
                <th>Name</th>
                <th>Audience</th>
                <th className="text-right">Steps</th>
                <th className="text-right">Enrolled</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ sequence, campaignTitle, stepCount, enrolledCount }) => (
                <tr key={sequence.id}>
                  <td className="px-4 py-2.5">
                    <Link href={`/broadcast/${sequence.id}`} className="font-medium text-zinc-100 hover:text-emerald-400">
                      <span className="inline-flex items-center gap-1.5">
                        <Send className="h-3.5 w-3.5 text-zinc-500" /> {sequence.name}
                      </span>
                    </Link>
                  </td>
                  <td className="px-2 py-2.5 text-xs text-zinc-400">
                    {AUDIENCE_LABELS[sequence.audience_type]}
                    {campaignTitle ? ` — ${campaignTitle}` : ""}
                  </td>
                  <td className="px-2 py-2.5 text-right tabular-nums">{stepCount}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums">{enrolledCount}</td>
                  <td className="px-2 py-2.5">
                    <span className={`chip ${STATUS_COLORS[sequence.status]}`}>{sequence.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
