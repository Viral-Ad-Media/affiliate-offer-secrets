"use client";

import { useState } from "react";
import { Loader2, Save, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { BroadcastSequence } from "@/lib/shared";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export default function BroadcastSequenceForm({
  sequence,
  campaignOptions,
  editable,
  onSaved,
}: {
  sequence: BroadcastSequence;
  campaignOptions: { id: string; title: string }[];
  editable: boolean;
  onSaved: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(sequence.name);
  const [audienceType, setAudienceType] = useState(sequence.audience_type);
  const [campaignId, setCampaignId] = useState(sequence.campaign_id ?? campaignOptions[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    const { error: err } = await createClient().rpc("update_broadcast_sequence", {
      p_sequence_id: sequence.id,
      p_name: name,
      p_audience_type: audienceType,
      p_campaign_id: audienceType === "campaign" ? campaignId || null : null,
    });
    setBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    onSaved();
  }

  async function remove() {
    if (!confirm(`Delete "${sequence.name}"? This can't be undone.`)) return;
    setBusy(true);
    await createClient().rpc("delete_broadcast_sequence", { p_sequence_id: sequence.id });
    router.push("/emails/sequences");
  }

  return (
    <Card as="section" className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-100">Sequence details</h2>
        {editable && (
          <Button onClick={remove} disabled={busy} variant="outline" className="!py-1 text-xs hover:!border-red-500 hover:!text-red-300">
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </Button>
        )}
      </div>
      {!editable && (
        <p className="mb-3 rounded-lg bg-ink-800 p-2.5 text-xs text-zinc-400">
          Pause this sequence to edit its audience — steps can still be edited while paused.
        </p>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-zinc-400">Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={!editable}
            className="w-64 rounded-lg border border-ink-600 bg-ink-900 px-3 py-2 text-sm outline-none focus:border-emerald-500 disabled:opacity-50"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-zinc-400">Audience</label>
          <select
            value={audienceType}
            onChange={(e) => setAudienceType(e.target.value as any)}
            disabled={!editable}
            className="rounded-lg border border-ink-600 bg-ink-900 py-2 px-3 text-sm outline-none focus:border-emerald-500 disabled:opacity-50"
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
              disabled={!editable}
              className="rounded-lg border border-ink-600 bg-ink-900 py-2 px-3 text-sm outline-none focus:border-emerald-500 disabled:opacity-50"
            >
              {campaignOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          </div>
        )}
        {editable && (
          <Button onClick={save} disabled={busy || !name.trim()}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save
          </Button>
        )}
      </div>
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
    </Card>
  );
}
