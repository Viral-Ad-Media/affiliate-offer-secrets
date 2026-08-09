"use client";

import { useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Trash2,
  Pencil,
  Eye,
  CheckCircle2,
  TrendingUp,
  CreditCard,
  MoreHorizontal,
  Loader2,
} from "lucide-react";
import type { FunnelStep, FunnelStepType } from "@/lib/shared";
import SplitTestBranch from "@/components/SplitTestBranch";
import { NodeCard } from "@/components/FunnelNodeCard";
import { Card } from "@/components/ui/card";
import { STEP_TYPE_LABELS } from "@/lib/funnelTypes";

// Shared with the step editor's checklist header — see lib/funnelTypes.ts.
const STEP_LABELS = STEP_TYPE_LABELS;

const STEP_ICONS: Record<FunnelStepType, typeof CheckCircle2> = {
  thank_you: CheckCircle2,
  upsell: TrendingUp,
  order: CreditCard,
};

/**
 * The map reads LEFT TO RIGHT on a canvas, one card per page, each card showing a real miniature
 * of that page — the shape every funnel builder uses, and the reason it is called a map rather
 * than a list. It was a stack of full-width table-ish rows before, which told you the order and
 * nothing else: you could not tell an opt-in from a thank-you page without reading the label.
 *
 * Horizontal because a funnel is a sequence in time, and because a split test then draws as what
 * it actually is — one column that forks into parallel cards and merges back into the next step.
 * Vertically stacked rows cannot show that without the branch looking like two separate steps.
 */
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
    <Card as="section" className="overflow-hidden p-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-ink-700 px-4 py-3">
        <h2 className="text-sm font-semibold text-zinc-100">Funnel map</h2>
        <p className="text-xs text-zinc-500">
          Visitors move left to right. Click a page to edit it, or the + between two pages to add one there.
        </p>
      </div>
      {error && <p className="border-b border-ink-700 px-4 py-2 text-sm text-red-300">{error}</p>}

      {/* The canvas. Dotted grid drawn from the theme's own ink-700 token, so it inverts with the
          rest of the app in light mode instead of being a hard-coded dark texture. */}
      <div
        className="overflow-x-auto px-6 py-8"
        style={{
          backgroundImage: "radial-gradient(rgb(var(--ink-700)) 1px, transparent 1px)",
          backgroundSize: "18px 18px",
        }}
      >
        <div className="flex min-w-max items-start gap-0">
          <SplitTestBranch
            campaignId={campaignId}
            bridgeHtml={bridgeHtml}
            onEditControl={onSelectOptin}
            onEditVariant={onSelectVariant}
          />

          {steps.map((step, i) => {
            const Icon = STEP_ICONS[step.step_type];
            const prevIndex = steps[i - 1]?.step_index ?? 0;
            return (
              <div key={step.id} className="contents">
                {/* The connector BEFORE this step inserts after the previous one — you choose the
                    position by clicking where the page should go, rather than appending and then
                    walking it back with arrows. */}
                <Connector busy={busy === `insert-${prevIndex}`} onInsert={(t) => addStep(t, prevIndex)} />
                <NodeCard
                  icon={Icon}
                  badge={`Step ${i + 1}`}
                  title={STEP_LABELS[step.step_type]}
                  subtitle={step.step_type === "upsell" ? "Accept / decline cross-sell" : "Shown after the previous page"}
                  html={step.html}
                  onOpen={() => onSelectStep(step.id)}
                  actions={
                    <>
                      <ThumbAction as="a" href={`/preview/step/${step.id}`} title="Preview in a new tab">
                        <Eye className="h-3.5 w-3.5" />
                      </ThumbAction>
                      <ThumbAction onClick={() => onSelectStep(step.id)} title="Edit this page">
                        <Pencil className="h-3.5 w-3.5" />
                      </ThumbAction>
                      <NodeMenu
                        busy={busy === step.id}
                        canMoveUp={i > 0}
                        canMoveDown={i < steps.length - 1}
                        onMoveUp={() => move(step.id, "up")}
                        onMoveDown={() => move(step.id, "down")}
                        onDelete={() => remove(step.id)}
                      />
                    </>
                  }
                />
              </div>
            );
          })}

          <Connector busy={busy === "add"} onInsert={(t) => addStep(t, null)} />
          <AddCard busy={busy === "add"} onAdd={(t) => addStep(t, null)} />
        </div>
      </div>
    </Card>
  );
}

/** A button drawn over a thumbnail. `as="a"` for the preview, which must be a real link. */
function ThumbAction({
  as = "button",
  href,
  title,
  onClick,
  children,
}: {
  as?: "button" | "a";
  href?: string;
  title: string;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  const cls =
    "flex h-7 w-7 items-center justify-center rounded-md bg-ink-900/90 text-zinc-200 ring-1 ring-white/10 hover:bg-ink-800 hover:text-emerald-300 focus:outline-none focus:ring-2 focus:ring-emerald-400";
  if (as === "a") {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" title={title} aria-label={title} className={cls}>
        {children}
      </a>
    );
  }
  return (
    <button type="button" onClick={onClick} title={title} aria-label={title} className={cls}>
      {children}
    </button>
  );
}

/**
 * The line between two pages, and the place you add one.
 *
 * The insert affordance is ON the connector rather than in a form at the end, which is what makes
 * "add a page HERE" one click instead of add-then-reorder. Hover/focus-revealed so a funnel at
 * rest reads as a clean flow — and a real `<button>`, so keyboard focus reveals it too.
 *
 * `mt-14` lines the arrow up with the middle of the card's thumbnail rather than the middle of the
 * whole card, whose height varies with how much a node has to say.
 */
function Connector({ busy, onInsert }: { busy: boolean; onInsert: (t: FunnelStepType) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="group relative mt-14 flex w-14 shrink-0 items-center justify-center">
      <div className="absolute inset-x-0 h-px bg-ink-600" />
      <div className="absolute right-0 h-1.5 w-1.5 rotate-45 border-r border-t border-ink-500" />
      {busy ? (
        <Loader2 className="relative h-4 w-4 animate-spin text-emerald-400" />
      ) : (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          title="Add a page here"
          aria-label="Add a page here"
          aria-expanded={open}
          className={`relative flex h-5 w-5 items-center justify-center rounded-full border border-emerald-500/50 bg-ink-900 text-emerald-400 transition-opacity hover:bg-emerald-500/15 focus:opacity-100 focus:outline-none focus:ring-1 focus:ring-emerald-400 ${
            open ? "opacity-100" : "opacity-0 group-hover:opacity-100"
          }`}
        >
          <Plus className="h-3 w-3" />
        </button>
      )}
      {open && (
        <>
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-10 cursor-default"
          />
          <div className="absolute top-7 z-20 flex flex-col gap-0.5 rounded-lg border border-ink-600 bg-ink-900 p-1 shadow-lg">
            {(Object.keys(STEP_LABELS) as FunnelStepType[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => {
                  setOpen(false);
                  onInsert(t);
                }}
                className="whitespace-nowrap rounded px-2 py-1 text-left text-xs text-zinc-300 hover:bg-ink-800 hover:text-emerald-300"
              >
                {STEP_LABELS[t]}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * The end of the funnel, as a card in the flow rather than a form underneath it.
 *
 * The hover + circles are discoverable once you know they are there; this is what tells you the
 * funnel can grow at all, and it sits where the next page would actually appear.
 */
function AddCard({ busy, onAdd }: { busy: boolean; onAdd: (t: FunnelStepType) => void }) {
  return (
    <div className="flex w-56 shrink-0 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-ink-600 p-4 text-center">
      <Plus className="h-5 w-5 text-zinc-600" />
      <div className="text-xs text-zinc-500">Add a page to the end</div>
      <div className="flex flex-wrap justify-center gap-1">
        {(Object.keys(STEP_LABELS) as FunnelStepType[]).map((t) => (
          <button
            key={t}
            type="button"
            disabled={busy}
            onClick={() => onAdd(t)}
            className="rounded-md border border-ink-600 px-2 py-1 text-[11px] text-zinc-300 hover:border-emerald-500/50 hover:text-emerald-300 disabled:opacity-40"
          >
            {STEP_LABELS[t]}
          </button>
        ))}
      </div>
      {busy && <Loader2 className="h-4 w-4 animate-spin text-emerald-400" />}
    </div>
  );
}

/**
 * Per-node actions behind a three-dot menu.
 *
 * Preview and Edit deliberately stay as direct buttons rather than moving inside — they are the
 * two things you do constantly. What lives in here is the rarely-used and the destructive, which
 * is what a crowded node should shed. Move up/down keep those words rather than left/right: they
 * mean earlier/later in the sequence, and the underlying RPC is `move_funnel_step('up'|'down')`.
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
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={busy}
        title="More actions"
        aria-label="More actions"
        aria-expanded={open}
        className="flex h-7 w-7 items-center justify-center rounded-md bg-ink-900/90 text-zinc-200 ring-1 ring-white/10 hover:bg-ink-800 hover:text-emerald-300 focus:outline-none focus:ring-2 focus:ring-emerald-400"
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MoreHorizontal className="h-3.5 w-3.5" />}
      </button>
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
          <div className="absolute bottom-9 right-0 z-20 w-40 rounded-lg border border-ink-600 bg-ink-900 p-1 shadow-lg">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onMoveUp();
              }}
              disabled={!canMoveUp}
              className={`${item} text-zinc-300 hover:bg-ink-800`}
            >
              <ChevronLeft className="h-3.5 w-3.5" /> Move earlier
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onMoveDown();
              }}
              disabled={!canMoveDown}
              className={`${item} text-zinc-300 hover:bg-ink-800`}
            >
              <ChevronRight className="h-3.5 w-3.5" /> Move later
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onDelete();
              }}
              className={`${item} text-red-300 hover:bg-ink-800`}
            >
              <Trash2 className="h-3.5 w-3.5" /> Delete page
            </button>
          </div>
        </>
      )}
    </div>
  );
}
