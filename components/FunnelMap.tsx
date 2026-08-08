"use client";

import { useState } from "react";
import {
  ChevronUp,
  ChevronDown,
  Plus,
  Trash2,
  Pencil,
  CheckCircle2,
  TrendingUp,
  CreditCard,
  ArrowDown,
} from "lucide-react";
import type { FunnelStep, FunnelStepType } from "@/lib/shared";
import SplitTestBranch from "@/components/SplitTestBranch";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import PreviewIconButton from "@/components/PreviewIconButton";
import { STEP_TYPE_LABELS } from "@/lib/funnelTypes";

// Shared with the step editor's checklist header — see lib/funnelTypes.ts.
const STEP_LABELS = STEP_TYPE_LABELS;

const STEP_ICONS: Record<FunnelStepType, typeof CheckCircle2> = {
  thank_you: CheckCircle2,
  upsell: TrendingUp,
  order: CreditCard,
};

export default function FunnelMap({
  campaignId,
  bridgeHtml,
  steps,
  onSelectOptin,
  onSelectVariant,
  onSelectStep,
  onChanged,
}: {
  campaignId: string;
  bridgeHtml: string | null;
  steps: FunnelStep[];
  onSelectOptin: () => void;
  onSelectVariant: (variantId: string) => void;
  onSelectStep: (stepId: string) => void;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
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
    if (res.ok) onChanged();
  }

  return (
    <Card as="section" className="p-4">
      <h2 className="mb-1 text-sm font-semibold text-zinc-100">Funnel map</h2>
      <p className="mb-4 text-xs text-zinc-500">
        Click a page to preview it or edit its copy. Pages run top to bottom in the order shown.
      </p>
      {error && <p className="mb-2 text-sm text-red-300">{error}</p>}

      <div className="flex flex-col items-stretch gap-1">
        <SplitTestBranch
          campaignId={campaignId}
          bridgeHtml={bridgeHtml}
          onEditControl={onSelectOptin}
          onEditVariant={onSelectVariant}
        />

        {steps.map((step, i) => {
          const Icon = STEP_ICONS[step.step_type];
          return (
            <div key={step.id} className="contents">
              <div className="flex justify-center py-0.5 text-zinc-600">
                <ArrowDown className="h-4 w-4" />
              </div>
              <MapNode
                icon={Icon}
                label={`${i + 1}. ${STEP_LABELS[step.step_type]}`}
                sublabel={
                  step.step_type === "upsell" ? "Accept/decline cross-sell" : "Shown after the previous page"
                }
                previewHtml={step.html}
                previewHref={`/preview/step/${step.id}`}
                onEdit={() => onSelectStep(step.id)}
                extra={
                  <>
                    <Button
                      onClick={() => move(step.id, "up")}
                      disabled={busy === step.id || i === 0}
                      
                      title="Move up" variant="outline" className="!px-2 !py-1">
                      <ChevronUp className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      onClick={() => move(step.id, "down")}
                      disabled={busy === step.id || i === steps.length - 1}
                      
                      title="Move down" variant="outline" className="!px-2 !py-1">
                      <ChevronDown className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      onClick={() => remove(step.id)}
                      disabled={busy === step.id}
                      
                      title="Delete step" variant="outline" className="!px-2 !py-1 hover:text-red-300">
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </>
                }
              />
            </div>
          );
        })}

        <div className="flex justify-center py-0.5 text-zinc-600">
          <ArrowDown className="h-4 w-4" />
        </div>
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-ink-600 p-3">
          <select
            value={addType}
            onChange={(e) => setAddType(e.target.value as FunnelStepType)}
            className="rounded-lg border border-ink-600 bg-ink-800 px-2 py-1.5 text-xs text-zinc-100"
          >
            <option value="thank_you">Thank-you</option>
            <option value="upsell">Upsell</option>
            <option value="order">Order</option>
          </select>
          <Button onClick={addStep} disabled={busy === "add"} variant="outline" className="!py-1 text-xs">
            <Plus className="h-3.5 w-3.5" /> Add step
          </Button>
        </div>
      </div>

    </Card>
  );
}

function MapNode({
  icon: Icon,
  label,
  sublabel,
  previewHtml,
  previewHref,
  onEdit,
  extra,
}: {
  icon: typeof CheckCircle2;
  label: string;
  sublabel: string;
  /** The page's currently-STORED html. Null for a step that's never been saved. */
  previewHtml: string | null;
  /** Its own /preview URL — a real link, available from generation rather than from publish. */
  previewHref?: string | null;
  onEdit: () => void;
  extra?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-ink-700 bg-ink-800/60 p-3">
      <div className="flex items-center gap-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-full border border-ink-600 bg-ink-900 text-emerald-400">
          <Icon className="h-4 w-4" />
        </span>
        <div>
          <div className="text-sm font-medium text-zinc-100">{label}</div>
          <div className="text-xs text-zinc-500">{sublabel}</div>
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        <PreviewIconButton html={previewHtml} title={label} href={previewHref} />
        <Button onClick={onEdit}  title="Edit" variant="outline" className="!px-2 !py-1">
          <Pencil className="h-3.5 w-3.5" />
        </Button>
        {extra}
      </div>
    </div>
  );
}
