"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead } from "@/components/ui/table";
import { Plus, Loader2, Send, Archive, ArchiveRestore, Trash2 } from "lucide-react";
import { toast } from "@/lib/toast";
import { createClient } from "@/lib/supabase/client";
import type { BroadcastSequence } from "@/lib/shared";
import { Button } from "@/components/ui/button";

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
  showingArchived = false,
}: {
  rows: Row[];
  campaignOptions: { id: string; title: string }[];
  showingArchived?: boolean;
}) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [audienceType, setAudienceType] = useState<"campaign" | "all" | "manual">("campaign");
  const [campaignId, setCampaignId] = useState(campaignOptions[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function bulk(action: "archive" | "unarchive" | "delete", extra: Record<string, unknown> = {}) {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    setBulkBusy(true);
    const res = await fetch("/api/broadcast/sequences/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, sequence_ids: ids, ...extra }),
    });
    const data = await res.json().catch(() => ({}));
    setBulkBusy(false);
    if (!res.ok) {
      toast.error(data.error ?? "Something went wrong");
      return;
    }
    const skipped = (data.skipped ?? []) as { id: string; reason: string }[];
    if (skipped.length > 0) {
      const name = rows.find((r) => r.sequence.id === skipped[0].id)?.sequence.name ?? "One sequence";
      toast.error(`${data.updated} updated. ${skipped.length} skipped — ${name}: ${skipped[0].reason}`);
    } else {
      toast.success(`${data.updated} sequence(s) updated`);
    }
    setSelected(new Set());
    router.refresh();
  }

  function confirmDelete() {
    const ids = Array.from(selected);
    const active = ids.filter((id) => rows.find((r) => r.sequence.id === id)?.sequence.status === "active");
    // The active ones are refused server-side regardless; saying so here means nobody presses
    // delete expecting a running drip to stop and then has to work out why it didn't.
    const ok = window.confirm(
      `Delete ${ids.length} sequence${ids.length === 1 ? "" : "s"}?\n\n` +
        (active.length > 0
          ? `${active.length} of them ${active.length === 1 ? "is" : "are"} still sending and will be skipped — pause or archive ${
              active.length === 1 ? "it" : "them"
            } instead.\n\n`
          : "") +
        `This removes their steps and every contact's remaining schedule. The record of mail already sent is kept.\n\nThere is no undo.`
    );
    if (ok) bulk("delete", { confirm: true });
  }

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
    router.push(`/emails/sequences/${data}`);
  }

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-ink-700 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-zinc-100">Sequences</h2>
          <p className="text-xs text-zinc-500">Named drip sequences, each with its own audience and steps.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setCreating((v) => !v)} className="text-xs">
            <Plus className="h-3.5 w-3.5" /> New sequence
          </Button>
        </div>
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
            <Button
              onClick={create}
              disabled={busy || !name.trim() || (audienceType === "campaign" && !campaignId)}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Create
            </Button>
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
          {selected.size > 0 && (
            <div className="flex flex-wrap items-center gap-2 border-b border-ink-800 bg-ink-800/40 px-4 py-2">
              <span className="text-xs text-zinc-300">{selected.size} selected</span>
              <button onClick={() => setSelected(new Set())} className="text-xs text-zinc-500 hover:text-zinc-300">
                Clear
              </button>
              <div className="ml-auto flex flex-wrap items-center gap-1.5">
                <Button
                  onClick={() => bulk(showingArchived ? "unarchive" : "archive")}
                  disabled={bulkBusy}
                  variant="outline"
                  className="text-xs"
                >
                  {showingArchived ? <ArchiveRestore className="h-3.5 w-3.5" /> : <Archive className="h-3.5 w-3.5" />}
                  {showingArchived ? "Restore" : "Archive"}
                </Button>
                <Button
                  onClick={confirmDelete}
                  disabled={bulkBusy}
                  variant="outline"
                  className="border-red-500/40 text-xs text-red-300 hover:border-red-500/60"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Delete
                </Button>
                {bulkBusy && <Loader2 className="h-3.5 w-3.5 animate-spin text-zinc-400" />}
              </div>
            </div>
          )}
          <div className="flex justify-end px-4 pt-2">
            <Link
              href={showingArchived ? "/emails/sequences" : "/emails/sequences?archived=1"}
              className="inline-flex items-center gap-1.5 text-xs text-zinc-500 hover:text-emerald-300"
            >
              <Archive className="h-3.5 w-3.5" />
              {showingArchived ? "Active sequences" : "Archived"}
            </Link>
          </div>
          <Table className="text-sm">
            <TableHeader>
              <tr>
                <TableHead edge className="w-8">
                  <input
                    type="checkbox"
                    aria-label="Select all sequences"
                    className="h-3.5 w-3.5 accent-emerald-500"
                    checked={rows.length > 0 && selected.size === rows.length}
                    onChange={(e) =>
                      setSelected(e.target.checked ? new Set(rows.map((r) => r.sequence.id)) : new Set())
                    }
                  />
                </TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Audience</TableHead>
                <TableHead className="text-right">Steps</TableHead>
                <TableHead className="text-right">Enrolled</TableHead>
                <TableHead edge>Status</TableHead>
              </tr>
            </TableHeader>
            <TableBody>
              {rows.map(({ sequence, campaignTitle, stepCount, enrolledCount }) => (
                <TableRow key={sequence.id}>
                  <td className="px-4 py-2.5">
                    <input
                      type="checkbox"
                      aria-label={`Select ${sequence.name}`}
                      className="h-3.5 w-3.5 accent-emerald-500"
                      checked={selected.has(sequence.id)}
                      onChange={() => toggle(sequence.id)}
                    />
                  </td>
                  <td className="px-2 py-2.5">
                    <Link href={`/emails/sequences/${sequence.id}`} className="font-medium text-zinc-100 hover:text-emerald-400">
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
                    <Badge className={STATUS_COLORS[sequence.status]}>{sequence.status}</Badge>
                  </td>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </Card>
  );
}
