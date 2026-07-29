"use client";

import { useState } from "react";
import { ChevronUp, ChevronDown, Plus, Trash2, Pencil, X, Layers } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { FunnelStep, FunnelStepType } from "@/lib/shared";
import FunnelStepEditor from "@/components/FunnelStepEditor";

const STEP_LABELS: Record<FunnelStepType, string> = {
  thank_you: "Thank-you",
  upsell: "Upsell",
  order: "Order",
};

export default function FunnelStepsSection({
  campaignId,
  productTitle,
  steps,
  crossSellOptions,
  onChanged,
}: {
  campaignId: string;
  productTitle: string;
  steps: FunnelStep[];
  crossSellOptions: { id: string; title: string }[];
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [addType, setAddType] = useState<FunnelStepType>("thank_you");

  async function addStep() {
    setBusy("add");
    setError(null);
    const res = await fetch("/api/funnel-steps", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ campaign_id: campaignId, step_type: addType }),
    });
    const data = await res.json();
    setBusy(null);
    if (!res.ok) {
      setError(data.error ?? "Failed to add step");
      return;
    }
    onChanged();
  }

  async function move(stepId: string, direction: "up" | "down") {
    setBusy(stepId);
    const res = await fetch(`/api/funnel-steps/${stepId}/move`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ direction }),
    });
    setBusy(null);
    if (res.ok) onChanged();
  }

  async function remove(stepId: string) {
    setBusy(stepId);
    const res = await fetch(`/api/funnel-steps/${stepId}`, { method: "DELETE" });
    setBusy(null);
    if (res.ok) {
      if (editingId === stepId) setEditingId(null);
      onChanged();
    }
  }

  const editingStep = steps.find((s) => s.id === editingId) ?? null;

  return (
    <section className="card p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-zinc-100">
        <Layers className="h-4 w-4 text-emerald-400" /> Funnel steps
      </div>
      <p className="mb-3 text-xs text-zinc-500">
        Pages shown after a visitor opts in, in order. With none added, the opt-in page reveals the
        hoplink CTA in place, exactly as before.
      </p>
      {error && <p className="mb-2 text-sm text-red-300">{error}</p>}

      <div className="space-y-2">
        {steps.map((step, i) => (
          <div key={step.id} className="rounded-lg border border-ink-700 p-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="chip border-ink-600 bg-ink-800 text-zinc-300">
                  {i + 1}. {STEP_LABELS[step.step_type]}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => move(step.id, "up")}
                  disabled={busy === step.id || i === 0}
                  className="btn-ghost !px-2 !py-1"
                  title="Move up"
                >
                  <ChevronUp className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => move(step.id, "down")}
                  disabled={busy === step.id || i === steps.length - 1}
                  className="btn-ghost !px-2 !py-1"
                  title="Move down"
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => setEditingId(editingId === step.id ? null : step.id)}
                  className="btn-ghost !px-2 !py-1"
                  title="Edit copy"
                >
                  {editingId === step.id ? <X className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />}
                </button>
                <button
                  onClick={() => remove(step.id)}
                  disabled={busy === step.id}
                  className="btn-ghost !px-2 !py-1 hover:text-red-300"
                  title="Delete step"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>
        ))}

        {editingStep && (
          <div className="rounded-lg border border-ink-700 p-3">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Editing {STEP_LABELS[editingStep.step_type]}
            </div>
            <FunnelStepEditor
              stepId={editingStep.id}
              stepType={editingStep.step_type}
              productTitle={productTitle}
              initialCopy={editingStep.page_copy}
              initialHtml={editingStep.html}
              initialCtaAction={editingStep.cta_action}
              initialTargetProductId={editingStep.target_product_id}
              crossSellOptions={crossSellOptions}
              onSaved={() => onChanged()}
            />
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <select
            value={addType}
            onChange={(e) => setAddType(e.target.value as FunnelStepType)}
            className="rounded-lg border border-ink-600 bg-ink-800 px-2 py-1.5 text-xs text-zinc-100"
          >
            <option value="thank_you">Thank-you</option>
            <option value="upsell">Upsell</option>
            <option value="order">Order</option>
          </select>
          <button onClick={addStep} disabled={busy === "add"} className="btn-ghost !py-1 text-xs">
            <Plus className="h-3.5 w-3.5" /> Add step
          </button>
        </div>
      </div>
    </section>
  );
}
