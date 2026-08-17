"use client";

import { useState } from "react";
import { Plus, Trash2, Save, Loader2 } from "lucide-react";
import EditorPreviewButton from "@/components/EditorPreview";
import { renderEmailPreviewHtml } from "@/lib/engine/broadcastEmail";
import { createClient } from "@/lib/supabase/client";
import type { BroadcastStep } from "@/lib/shared";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { composeSms, smsSegments, MAX_SMS_BODY } from "@/lib/sms";
import { cn } from "@/lib/utils";

type DraftStep = Partial<BroadcastStep> & { key: string; step_index: number; delay_days: number; subject: string; body_md: string };

function toDraft(s: BroadcastStep): DraftStep {
  return { key: s.id, id: s.id, step_index: s.step_index, delay_days: s.delay_days, subject: s.subject, body_md: s.body_md };
}

export default function BroadcastStepsEditor({
  sequenceId,
  steps,
  editable,
  channel = "email",
  onChanged,
}: {
  sequenceId: string;
  steps: BroadcastStep[];
  editable: boolean;
  onChanged: () => void;
  /** SMS steps have no subject and a hard character budget. */
  channel?: "email" | "sms";
}) {
  const [drafts, setDrafts] = useState<DraftStep[]>(steps.map(toDraft));
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const isSms = channel === "sms";
  const [error, setError] = useState<string | null>(null);

  // Re-sync local drafts whenever the parent's steps prop changes (after a save/delete reload).
  if (
    drafts.length !== steps.length ||
    !steps.every((s, i) => drafts[i]?.id === s.id)
  ) {
    if (JSON.stringify(steps.map((s) => s.id)) !== JSON.stringify(drafts.map((d) => d.id))) {
      setDrafts(steps.map(toDraft));
    }
  }

  function updateDraft(key: string, patch: Partial<DraftStep>) {
    setDrafts((cur) => cur.map((d) => (d.key === key ? { ...d, ...patch } : d)));
  }

  function addStep() {
    const nextIndex = drafts.length > 0 ? Math.max(...drafts.map((d) => d.step_index)) + 1 : 0;
    setDrafts((cur) => [
      ...cur,
      {
        key: `new-${nextIndex}`,
        step_index: nextIndex,
        delay_days: nextIndex === 0 ? 0 : 3,
        // broadcast_steps.subject is NOT NULL and is never sent for sms — an internal label keeps
        // the column honest without widening it (see 0098).
        subject: channel === "sms" ? `Message ${nextIndex}` : "",
        body_md: "",
      },
    ]);
  }

  async function saveStep(draft: DraftStep) {
    setBusyKey(draft.key);
    setError(null);
    const { error: err } = await createClient().rpc("upsert_broadcast_step", {
      p_sequence_id: sequenceId,
      p_step_index: draft.step_index,
      p_delay_days: draft.delay_days,
      p_subject: draft.subject,
      p_body_md: draft.body_md,
    });
    setBusyKey(null);
    if (err) {
      setError(err.message);
      return;
    }
    onChanged();
  }

  async function deleteStep(draft: DraftStep) {
    if (!draft.id) {
      setDrafts((cur) => cur.filter((d) => d.key !== draft.key));
      return;
    }
    setBusyKey(draft.key);
    await createClient().rpc("delete_broadcast_step", { p_step_id: draft.id });
    setBusyKey(null);
    onChanged();
  }

  return (
    <Card as="section" className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-zinc-100">Steps</h2>
          <p className="text-xs text-zinc-500">Each fires this many days after a contact's own enrollment.</p>
        </div>
        {editable && (
          <Button onClick={addStep} variant="outline" className="!py-1 text-xs">
            <Plus className="h-3.5 w-3.5" /> Add step
          </Button>
        )}
      </div>

      {drafts.length === 0 ? (
        <p className="py-6 text-center text-sm text-zinc-500">No steps yet — add at least one before activating.</p>
      ) : (
        <div className="space-y-3">
          {drafts.map((d, i) => (
            <div key={d.key} className="rounded-lg border border-ink-700 p-3">
              <div className="mb-2 flex items-center gap-2">
                <Badge className="!py-0.5 text-[12px]">Step {i + 1}</Badge>
                <label className="text-xs text-zinc-400">Send</label>
                <input
                  type="number"
                  min={0}
                  value={d.delay_days}
                  onChange={(e) => updateDraft(d.key, { delay_days: Number(e.target.value) || 0 })}
                  disabled={!editable}
                  className="w-16 rounded-lg border border-ink-600 bg-ink-900 px-2 py-1 text-xs outline-none focus:border-emerald-500 disabled:opacity-50"
                />
                <span className="text-xs text-zinc-400">days after enrollment</span>
              </div>
              {isSms ? null : (
                <input
                  value={d.subject}
                  onChange={(e) => updateDraft(d.key, { subject: e.target.value })}
                  placeholder="Subject"
                  disabled={!editable}
                  className="mb-2 w-full rounded-lg border border-ink-600 bg-ink-900 px-3 py-2 text-sm outline-none focus:border-emerald-500 disabled:opacity-50"
                />
              )}
              <textarea
                value={d.body_md}
                onChange={(e) => updateDraft(d.key, { body_md: e.target.value })}
                rows={isSms ? 3 : 5}
                maxLength={isSms ? MAX_SMS_BODY : undefined}
                placeholder={isSms ? "Message text" : "Email body (markdown)"}
                disabled={!editable}
                className="w-full rounded-lg border border-ink-600 bg-ink-900 p-3 text-sm outline-none focus:border-emerald-500 disabled:opacity-50"
              />
              {isSms && (
                // Shown as it will actually send — composeSms adds the code-owned STOP line to the
                // first message, so the character budget only balances if the preview includes it.
                <div className="mt-1.5 space-y-1">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-zinc-600">
                      {d.body_md.length}/{MAX_SMS_BODY} characters
                    </span>
                    <span
                      className={
                        smsSegments(composeSms(d.body_md, i)).segments > 1 ? "text-amber-300" : "text-zinc-600"
                      }
                    >
                      {smsSegments(composeSms(d.body_md, i)).segments} segment
                      {smsSegments(composeSms(d.body_md, i)).segments === 1 ? "" : "s"}
                    </span>
                  </div>
                  <p className="rounded-lg border border-ink-700 bg-ink-900/60 p-2 text-xs text-zinc-300">
                    {composeSms(d.body_md || "…", i)}
                  </p>
                </div>
              )}
              {editable && (
                <div className="mt-2 flex items-center gap-2">
                  {/* SMS previews inline above — there is no document to open. */}
                  {!isSms && (
                    <EditorPreviewButton
                      className={cn(buttonVariants({ variant: "outline" }), "flex items-center gap-1.5 text-xs")}
                      label="Preview"
                      title={`Preview — ${d.subject || "email"}`}
                      render={() => renderEmailPreviewHtml({ subject: d.subject, body_md: d.body_md })}
                    />
                  )}
                  <Button
                    onClick={() => saveStep(d)}
                    disabled={busyKey === d.key || (isSms ? !d.body_md.trim() : !d.subject.trim())} variant="outline" className="!py-1 text-xs">
                    {busyKey === d.key ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                    Save
                  </Button>
                  <Button
                    onClick={() => deleteStep(d)}
                    disabled={busyKey === d.key} variant="outline" className="!py-1 text-xs hover:!border-red-500 hover:!text-red-300">
                    <Trash2 className="h-3.5 w-3.5" /> Remove
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
    </Card>
  );
}
