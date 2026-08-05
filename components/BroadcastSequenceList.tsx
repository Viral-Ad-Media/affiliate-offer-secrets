"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead } from "@/components/ui/table";
import { Plus, Loader2, Send , Layers} from "lucide-react";
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
}: {
  rows: Row[];
  campaignOptions: { id: string; title: string }[];
}) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
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
    router.push(`/emails/sequences/${data}`);
  }

  // Every campaign kit already contains a 3-email swipe; this turns each one into a real drip
  // sequence. Draft only — activating starts sending to real people, which stays a deliberate act.
  async function importAll() {
    setImporting(true);
    setError(null);
    try {
      const res = await fetch("/api/broadcast/sequences/import-all", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Import failed");
      if (data.created > 0) {
        toast.success(
          `${data.created} draft ${data.created === 1 ? "sequence" : "sequences"} created from your campaign swipes`
        );
      } else {
        toast.info("Every campaign with an email swipe already has a sequence");
      }
      if (data.failed > 0) toast.error(`${data.failed} couldn't be imported`);
      router.refresh();
    } catch (err: any) {
      setError(err?.message ?? String(err));
      toast.error(err?.message ?? String(err));
    } finally {
      setImporting(false);
    }
  }

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-ink-700 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-zinc-100">Sequences</h2>
          <p className="text-xs text-zinc-500">Named drip sequences, each with its own audience and steps.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={importAll}
            disabled={importing}
            title="Create a draft sequence from every campaign kit's generated email swipe"
            className="text-xs"
          >
            {importing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Layers className="h-3.5 w-3.5" />}
            Import all swipes
          </Button>
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
          <Table className="text-sm">
            <TableHeader>
              <tr>
                <TableHead edge>Name</TableHead>
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
