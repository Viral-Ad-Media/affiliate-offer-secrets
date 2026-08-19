"use client";

import { useState } from "react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ChevronUp,
  ChevronDown,
  Plus,
  Trash2,
  Pencil,
  Eye,
  CheckCircle2,
  TrendingUp,
  CreditCard,
  MoreHorizontal,
  Loader2,
  GripVertical,
} from "lucide-react";
import { toast } from "@/lib/toast";
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
 * The map reads TOP TO BOTTOM on a canvas, one card per page, each card showing a real miniature
 * of that page — the reason it is a map rather than a list. It was full-width table-ish rows
 * before, which told you the order and nothing else: you could not tell an opt-in from a
 * thank-you page without reading the label.
 *
 * Vertical because a funnel is read as a descent — traffic enters at the top and narrows — and
 * because the page it lives on already scrolls vertically, so a long funnel grows the way the
 * page does instead of hiding its last steps behind a horizontal scrollbar nobody looks for.
 * A split test forks ACROSS at that one point (see SplitTestBranch) and merges back into the
 * single column below, which is exactly what the weighted split does to a visitor.
 */
export default function FunnelMap({
  campaignId,
  bridgeHtml,
  steps,
  pageStats = {},
  leads = 0,
  onSelectOptin,
  onSelectVariant,
  onSelectStep,
  onChanged,
}: {
  campaignId: string;
  bridgeHtml: string | null;
  steps: FunnelStep[];
  /** Per-page counters from funnel_page_stats, keyed 'optin' or the step's id (0110). */
  pageStats?: Record<string, { views: number; clicks: number }>;
  /** Captured leads — the contacts count, which is the exact record, never a second tally. */
  leads?: number;
  onSelectOptin: () => void;
  onSelectVariant: (variantId: string) => void;
  onSelectStep: (stepId: string) => void;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Optimistic order: the drop reflows the map immediately, the server confirms behind it. Local
  // state resyncs whenever the parent reloads (the BroadcastStepsEditor resync idiom) — comparing
  // id sequences, so a reorder we initiated doesn't fight its own echo.
  const [ordered, setOrdered] = useState<FunnelStep[]>(steps);
  if (ordered.length !== steps.length || !steps.every((st) => ordered.some((o) => o.id === st.id))) {
    setOrdered(steps);
  }
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  async function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = ordered.findIndex((st) => st.id === active.id);
    const to = ordered.findIndex((st) => st.id === over.id);
    if (from < 0 || to < 0) return;
    const prev = ordered;
    const next = arrayMove(ordered, from, to);
    setOrdered(next);
    const res = await fetch("/api/funnel-steps/reorder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ campaign_id: campaignId, step_ids: next.map((st) => st.id) }),
    });
    if (!res.ok) {
      // Revert — the page the visitor gets is the SERVER's order, and a map showing anything else
      // is the map lying. The RPC's own message ("list is out of date — reload") surfaces as-is.
      setOrdered(prev);
      const d = await res.json().catch(() => ({}));
      toast.error(d.error ?? "Couldn't reorder the steps");
      return;
    }
    onChanged();
  }

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
          Visitors move top to bottom. Click a page to edit it, or the + between two pages to add one there.
        </p>
      </div>
      {error && <p className="border-b border-ink-700 px-4 py-2 text-sm text-red-300">{error}</p>}

      {/* The canvas. Dotted grid drawn from the theme's own ink-700 token, so it inverts with the
          rest of the app in light mode instead of being a hard-coded dark texture. */}
      <div
        className="overflow-x-auto px-6 py-8"
        data-funnel-canvas
        style={{
          backgroundImage: "radial-gradient(rgb(var(--ink-700)) 1px, transparent 1px)",
          backgroundSize: "18px 18px",
        }}
      >
        <div className="flex min-w-max flex-col items-center gap-0">
          <SplitTestBranch
            campaignId={campaignId}
            bridgeHtml={bridgeHtml}
            entryStats={<StatLine views={pageStats["optin"]?.views ?? 0} clicks={pageStats["optin"]?.clicks ?? 0} leads={leads} />}
            onEditControl={onSelectOptin}
            onEditVariant={onSelectVariant}
          />

          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={ordered.map((st) => st.id)} strategy={verticalListSortingStrategy}>
          {ordered.map((step, i) => {
            const Icon = STEP_ICONS[step.step_type];
            const prevIndex = ordered[i - 1]?.step_index ?? 0;
            return (
              <div key={step.id} className="contents">
                {/* The connector BEFORE this step inserts after the previous one — you choose the
                    position by clicking where the page should go, rather than appending and then
                    walking it back with arrows. */}
                <Connector busy={busy === `insert-${prevIndex}`} onInsert={(t) => addStep(t, prevIndex)} />
                <SortableStepNode id={step.id}>
                <NodeCard
                  icon={Icon}
                  badge={`Step ${i + 1}`}
                  title={STEP_LABELS[step.step_type]}
                  subtitle={step.step_type === "upsell" ? "Accept / decline cross-sell" : "Shown after the previous page"}
                  html={step.html}
                  stats={<StatLine views={pageStats[step.id]?.views ?? 0} clicks={pageStats[step.id]?.clicks ?? 0} />}
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
                        canMoveDown={i < ordered.length - 1}
                        onMoveUp={() => move(step.id, "up")}
                        onMoveDown={() => move(step.id, "down")}
                        onDelete={() => remove(step.id)}
                      />
                    </>
                  }
                />
                </SortableStepNode>
              </div>
            );
          })}
          </SortableContext>
          </DndContext>

          <Connector busy={busy === "add"} onInsert={(t) => addStep(t, null)} />
          <AddCard busy={busy === "add"} onAdd={(t) => addStep(t, null)} />
        </div>
      </div>
    </Card>
  );
}

/**
 * One page's traffic, in the card footer. Views are visitors (deduped per browser by the fs_
 * cookie, same discipline as the split test's counter), clicks are outbound link clicks from the
 * page's beacon, and opt-ins — entry page only — are the real contacts count with the rate that
 * follows. Rendered even at zero so the map says what is being measured, rather than numbers
 * appearing unannounced with the first visitor.
 */
function StatLine({ views, clicks, leads }: { views: number; clicks: number; leads?: number }) {
  const rate = leads !== undefined && views > 0 ? ` (${((leads / views) * 100).toFixed(1)}%)` : "";
  return (
    <span className="text-[11px] tabular-nums text-zinc-500">
      {views.toLocaleString()} views
      {leads !== undefined && (
        <>
          {" · "}
          <span className="text-emerald-400">
            {leads.toLocaleString()} opt-ins{rate}
          </span>
        </>
      )}
      {" · "}
      {clicks.toLocaleString()} clicks
    </span>
  );
}

/**
 * Sortable wrapper for one step node. Module scope, never defined inside FunnelMap's body — an
 * inline component gets a fresh identity every render, which would unmount the card (and its
 * hover state) on each reorder.
 *
 * The grip is a dedicated handle rather than making the whole card draggable: the card's click
 * already means "open the editor", and stealing pointer-down for dragging would make every open a
 * gamble on the 4px activation distance.
 */
function SortableStepNode({ id, children }: { id: string; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`group/drag relative ${isDragging ? "z-30 opacity-80" : ""}`}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label="Drag to reorder this step"
        title="Drag to reorder"
        className="absolute -left-8 top-1/2 z-10 -translate-y-1/2 cursor-grab rounded-lg border border-ink-600 bg-ink-900 p-1.5 text-zinc-500 opacity-60 transition-opacity hover:text-emerald-300 focus-visible:opacity-100 group-hover/drag:opacity-100 active:cursor-grabbing"
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>
      {children}
    </div>
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
 * `w-56` matches a card so the line sits under the centre of the column rather than needing the
 * parent to know anything about connector widths.
 */
function Connector({ busy, onInsert }: { busy: boolean; onInsert: (t: FunnelStepType) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="group relative flex h-12 w-56 shrink-0 items-center justify-center">
      <div className="absolute inset-y-0 w-px bg-ink-600" />
      <div className="absolute bottom-0 h-1.5 w-1.5 rotate-45 border-b border-r border-ink-500" />
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
          <div className="absolute left-1/2 top-7 z-20 flex -translate-x-1/2 flex-col gap-0.5 rounded-lg border border-ink-600 bg-ink-900 p-1 shadow-lg">
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
 * is what a crowded node should shed. Up/down match both the column's own direction and the
 * underlying RPC, `move_funnel_step('up'|'down')`.
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
              <ChevronUp className="h-3.5 w-3.5" /> Move up
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
              <ChevronDown className="h-3.5 w-3.5" /> Move down
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
