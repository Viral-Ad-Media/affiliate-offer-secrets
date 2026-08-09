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
  MoreHorizontal,
  Loader2,
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

  // `afterIndex` is the step_index to insert AFTER — 0 puts the new page straight after the
  // opt-in, null appends. Mirrors add_funnel_step's own p_after_index (0083).
  async function addStep(stepType: FunnelStepType, afterIndex: number | null) {
    setBusy(afterIndex === null ? "add" : `insert-${afterIndex}`);
    setError(null);
    const res = await fetch("/api/funnel-steps", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        campaign_id: campaignId,
        step_type: stepType,
        ...(afterIndex === null ? {} : { after_index: afterIndex }),
      }),
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
              {/* The connector ABOVE this step inserts before it — i.e. after the previous one.
                  ClickFunnels' defining interaction: you choose the position by clicking where the
                  page should go, instead of appending and then walking it up with arrows. */}
              <Connector
                busy={busy === `insert-${steps[i - 1]?.step_index ?? 0}`}
                onInsert={(t) => addStep(t, steps[i - 1]?.step_index ?? 0)}
              />
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
                  <NodeMenu
                    busy={busy === step.id}
                    canMoveUp={i > 0}
                    canMoveDown={i < steps.length - 1}
                    onMoveUp={() => move(step.id, "up")}
                    onMoveDown={() => move(step.id, "down")}
                    onDelete={() => remove(step.id)}
                  />
                }
              />
            </div>
          );
        })}

        <Connector busy={busy === "add"} onInsert={(t) => addStep(t, null)} />
        {/* The explicit end-of-funnel affordance stays. The hover circles are discoverable once you
            know they are there; a visible control is what tells you the funnel can grow at all. */}
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
          <Button onClick={() => addStep(addType, null)} disabled={busy === "add"} variant="outline" className="!py-1 text-xs">
            <Plus className="h-3.5 w-3.5" /> Add step to the end
          </Button>
        </div>
      </div>

    </Card>
  );
}

/**
 * The line between two pages, and the place you add one.
 *
 * ClickFunnels puts the insert affordance ON the connector rather than in a form at the bottom,
 * which is what makes "add a page HERE" a single click instead of add-then-reorder. The circle is
 * hover/focus-revealed so a funnel at rest still reads as a clean flow — and it is a real
 * `<button>`, so keyboard focus reveals it too rather than leaving it mouse-only.
 */
function Connector({ busy, onInsert }: { busy: boolean; onInsert: (t: FunnelStepType) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="group relative flex justify-center py-0.5">
      {busy ? (
        <Loader2 className="h-4 w-4 animate-spin text-emerald-400" />
      ) : (
        <>
          <ArrowDown className="h-4 w-4 text-zinc-600 group-hover:opacity-0" />
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            title="Add a page here"
            aria-label="Add a page here"
            aria-expanded={open}
            className={`absolute inset-0 mx-auto flex h-5 w-5 items-center justify-center rounded-full border border-emerald-500/50 bg-ink-900 text-emerald-400 transition-opacity hover:bg-emerald-500/15 focus:opacity-100 focus:outline-none focus:ring-1 focus:ring-emerald-400 ${
              open ? "opacity-100" : "opacity-0 group-hover:opacity-100"
            }`}
          >
            <Plus className="h-3 w-3" />
          </button>
        </>
      )}
      {open && (
        <div className="absolute top-6 z-20 flex gap-1 rounded-lg border border-ink-600 bg-ink-900 p-1 shadow-lg">
          {(Object.keys(STEP_LABELS) as FunnelStepType[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => {
                setOpen(false);
                onInsert(t);
              }}
              className="whitespace-nowrap rounded px-2 py-1 text-xs text-zinc-300 hover:bg-ink-800 hover:text-emerald-300"
            >
              {STEP_LABELS[t]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Per-node actions behind a three-dot menu, matching ClickFunnels.
 *
 * Preview and Edit deliberately stay as direct buttons rather than moving inside — they are the
 * two things you do constantly, and CF's own menu is a place people hunt for them. This is an
 * adaptation of their pattern, not a copy of it: what moves in here is the rarely-used and the
 * destructive, which is what a crowded node row should shed.
 */
function NodeMenu({
  busy,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
  onDelete,
}: {
  busy: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const item = "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs disabled:opacity-40";
  return (
    <div className="relative">
      <Button
        onClick={() => setOpen((v) => !v)}
        disabled={busy}
        title="More"
        aria-label="More actions"
        aria-expanded={open}
        variant="outline"
        className="!px-2 !py-1"
      >
        <MoreHorizontal className="h-3.5 w-3.5" />
      </Button>
      {open && (
        <>
          {/* Click-away catcher. A menu you can only close with the same button is a menu people
              leave open by accident and then click through. */}
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-10 cursor-default"
          />
          <div className="absolute right-0 top-8 z-20 w-40 rounded-lg border border-ink-600 bg-ink-900 p-1 shadow-lg">
            <button type="button" onClick={() => { setOpen(false); onMoveUp(); }} disabled={!canMoveUp}
              className={`${item} text-zinc-300 hover:bg-ink-800`}>
              <ChevronUp className="h-3.5 w-3.5" /> Move up
            </button>
            <button type="button" onClick={() => { setOpen(false); onMoveDown(); }} disabled={!canMoveDown}
              className={`${item} text-zinc-300 hover:bg-ink-800`}>
              <ChevronDown className="h-3.5 w-3.5" /> Move down
            </button>
            <button type="button" onClick={() => { setOpen(false); onDelete(); }}
              className={`${item} text-red-300 hover:bg-ink-800`}>
              <Trash2 className="h-3.5 w-3.5" /> Delete page
            </button>
          </div>
        </>
      )}
    </div>
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
