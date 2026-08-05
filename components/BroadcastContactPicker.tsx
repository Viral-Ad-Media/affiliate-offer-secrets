"use client";

import { useState } from "react";
import { Loader2, Save } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Contact } from "@/lib/shared";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export default function BroadcastContactPicker({
  sequenceId,
  contacts,
  selectedIds,
  editable,
  onSaved,
}: {
  sequenceId: string;
  contacts: Contact[];
  selectedIds: string[];
  editable: boolean;
  onSaved: () => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set(selectedIds));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(id: string) {
    if (!editable) return;
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function save() {
    setBusy(true);
    setError(null);
    const { error: err } = await createClient().rpc("set_broadcast_sequence_contacts", {
      p_sequence_id: sequenceId,
      p_contact_ids: Array.from(selected),
    });
    setBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    onSaved();
  }

  return (
    <Card as="section" className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-ink-700 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-zinc-100">Contacts</h2>
          <p className="text-xs text-zinc-500">{selected.size} selected</p>
        </div>
        {editable && (
          <Button onClick={save} disabled={busy} className="text-xs">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            Save selection
          </Button>
        )}
      </div>
      {!editable && (
        <p className="border-b border-ink-700 px-4 py-2 text-xs text-zinc-500">
          Pause this sequence to change its contact selection.
        </p>
      )}
      {contacts.length === 0 ? (
        <p className="px-4 py-10 text-center text-sm text-zinc-500">
          No contacts captured yet — leads appear here once visitors submit a bridge page's opt-in form.
        </p>
      ) : (
        <div className="max-h-96 overflow-y-auto">
          <table className="w-full text-sm">
            <tbody>
              {contacts.map((c) => (
                <tr key={c.id} className="border-b border-ink-800">
                  <td className="w-8 px-4 py-2">
                    <input
                      type="checkbox"
                      checked={selected.has(c.id)}
                      onChange={() => toggle(c.id)}
                      disabled={!editable}
                      className="h-4 w-4 accent-emerald-600 disabled:opacity-50"
                    />
                  </td>
                  <td className="px-2 py-2 text-zinc-300">{c.first_name || "—"}</td>
                  <td className="px-2 py-2 text-zinc-300">{c.email}</td>
                  <td className="px-2 py-2 text-xs text-zinc-500">{c.campaign_title ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {error && <p className="border-t border-ink-700 px-4 py-2 text-xs text-red-400">{error}</p>}
    </Card>
  );
}
