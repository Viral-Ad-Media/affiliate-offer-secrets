"use client";

import { useState } from "react";
import { Beaker, Pencil, Pause, Play, Plus, Trash2, LogIn, Loader2, Eye } from "lucide-react";
import { useSplitTest } from "@/lib/useSplitTest";
import { NodeCard } from "@/components/FunnelNodeCard";
import EditorPreviewButton from "@/components/EditorPreview";
import { Button } from "@/components/ui/button";
import VariantConfidence, { MultipleVariantsNote } from "@/components/VariantConfidence";

// The opt-in page's position in the funnel map (components/FunnelMap.tsx) — either one card (no
// test running, the ~100% common case) or, once a split test is started, a real fork: parallel
// variant cards laid out ACROSS the column, which is what the weighted-random split
// (lib/bridgeVariants.ts's pickWeightedVariant) actually does to a visitor. They merge back into
// the single connector below, because that is also true — every variant leads to the same next
// step.
//
// This is the map-integrated counterpart to components/SplitTestPanel.tsx (the detailed list on
// the opt-in page's own editor view). Both share lib/useSplitTest.ts, so neither can drift on data
// or mutation behaviour; this one differs only in layout and in owning the "no test yet" state, so
// FunnelMap never needs its own awareness of whether a test is running.
export default function SplitTestBranch({
  campaignId,
  bridgeHtml,
  onEditControl,
  onEditVariant,
}: {
  campaignId: string;
  bridgeHtml: string | null;
  onEditControl: () => void;
  onEditVariant: (variantId: string) => void;
}) {
  const {
    variants,
    leadCounts,
    weights,
    setWeights,
    busy,
    error,
    startTest,
    addVariant,
    commitWeight,
    toggleStatus,
    deleteVariant,
    endTest,
  } = useSplitTest(campaignId);
  const [promoteId, setPromoteId] = useState<string>("");

  if (variants === null) return null;

  const action =
    "flex h-7 w-7 items-center justify-center rounded-md bg-ink-900/90 text-zinc-200 ring-1 ring-white/10 hover:bg-ink-800 hover:text-emerald-300 focus:outline-none focus:ring-2 focus:ring-emerald-400";

  if (variants.length === 0) {
    return (
      <div className="shrink-0">
        <NodeCard
          icon={LogIn}
          badge="Entry"
          title="Opt-in page"
          subtitle="Where the funnel captures a lead"
          html={bridgeHtml}
          onOpen={onEditControl}
          actions={
            <>
              <a
                href={`/preview/funnel/${campaignId}`}
                target="_blank"
                rel="noopener noreferrer"
                title="Preview in a new tab"
                aria-label="Preview the opt-in page"
                className={action}
              >
                <Eye className="h-3.5 w-3.5" />
              </a>
              <button type="button" onClick={onEditControl} title="Edit this page" aria-label="Edit the opt-in page" className={action}>
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={startTest}
                disabled={busy === "start"}
                title="Start a split test"
                aria-label="Start a split test"
                className={action}
              >
                {busy === "start" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Beaker className="h-3.5 w-3.5" />}
              </button>
            </>
          }
        />
        {error && <p className="mt-1 w-56 text-xs text-red-300">{error}</p>}
      </div>
    );
  }

  const nonControl = variants.filter((v) => !v.is_control);

  return (
    <div className="shrink-0 rounded-xl border border-dashed border-emerald-500/40 bg-emerald-500/[0.04] p-2.5">
      <div className="mb-2 flex items-center justify-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-emerald-300">
        <Beaker className="h-3.5 w-3.5" /> Split test · {variants.length} variants
      </div>
      {error && <p className="mb-2 text-center text-xs text-red-300">{error}</p>}

      {/* Side by side, because the map itself runs top to bottom: the fork happens at ONE point in
          the funnel, so the variants have to sit at the SAME height for the connector below to
          mean "and then all of them continue here". Stacking them in a vertical map would read as
          consecutive steps — which is exactly what they are not. Wraps on a narrow canvas rather
          than pushing a horizontal scrollbar onto a page that scrolls the other way. */}
      <div className="flex flex-wrap items-start justify-center gap-2">
        {variants.map((v) => {
          const leads = leadCounts[v.id] ?? 0;
          const rate = v.views > 0 ? `${((leads / v.views) * 100).toFixed(1)}%` : "—";
          return (
            <NodeCard
              key={v.id}
              icon={LogIn}
              badge={v.is_control ? `${v.label} · control` : v.label}
              title="Opt-in page"
              selectedTone="branch"
              // The control's own content lives on the campaign row, never on its variant row
              // (bridge_variants_control_no_content) — so its thumbnail reads bridgeHtml.
              html={v.is_control ? bridgeHtml : v.bridge_html}
              onOpen={() => (v.is_control ? onEditControl() : onEditVariant(v.id))}
              stats={
                <>
                  <label className="flex items-center gap-1" title="Share of traffic">
                    <input
                      type="number"
                      min={1}
                      max={100}
                      value={weights[v.id] ?? v.weight}
                      onChange={(e) => setWeights((w) => ({ ...w, [v.id]: Number(e.target.value) || 1 }))}
                      onBlur={() => weights[v.id] !== v.weight && commitWeight(v.id)}
                      className="w-11 rounded border border-ink-600 bg-ink-900 px-1 py-0.5 text-[11px] text-zinc-100"
                    />
                    wt
                  </label>
                  {/* "visitors", not "views": the counter is incremented once per sticky
                      assignment rather than once per request, so a refresh doesn't count again. */}
                  <span>{v.views} visitors</span>
                  <span>{leads} leads</span>
                  <span className={v.status === "paused" ? "text-zinc-600" : "text-emerald-300"}>
                    {v.status === "paused" ? "paused" : rate}
                  </span>
                  {/* Its own line — `stats` wraps, and the chip is a sentence rather than a
                      figure. basis-full forces the break instead of relying on the card width. */}
                  <span className="basis-full">
                    <VariantConfidence variant={v} variants={variants} leadCounts={leadCounts} />
                  </span>
                </>
              }
              actions={
                <>
                  {/* The control has a real, shareable /preview URL; a variant has no route of its
                      own, so it falls back to the blob preview — same sandboxed document either
                      way, so what you see (and what it can't fire) is identical. */}
                  {v.is_control ? (
                    <a
                      href={`/preview/funnel/${campaignId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Preview in a new tab"
                      aria-label={`Preview ${v.label}`}
                      className={action}
                    >
                      <Eye className="h-3.5 w-3.5" />
                    </a>
                  ) : (
                    <EditorPreviewButton
                      render={() => v.bridge_html || ""}
                      title={`Opt-in page — ${v.label}`}
                      label=""
                      className={action}
                    />
                  )}
                  <button
                    type="button"
                    onClick={() => (v.is_control ? onEditControl() : onEditVariant(v.id))}
                    title="Edit this variant"
                    aria-label={`Edit ${v.label}`}
                    className={action}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleStatus(v)}
                    disabled={busy === v.id}
                    title={v.status === "active" ? "Pause this variant" : "Resume this variant"}
                    aria-label={v.status === "active" ? `Pause ${v.label}` : `Resume ${v.label}`}
                    className={action}
                  >
                    {v.status === "active" ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                  </button>
                  {!v.is_control && (
                    <button
                      type="button"
                      onClick={() => deleteVariant(v.id)}
                      disabled={busy === v.id}
                      title="Delete this variant"
                      aria-label={`Delete ${v.label}`}
                      className={`${action} hover:text-red-300`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </>
              }
            />
          );
        })}
      </div>

      <div className="mx-auto max-w-lg text-center">
        <MultipleVariantsNote variants={variants} />
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-center gap-1.5">
        <Button
          onClick={addVariant}
          disabled={busy === "add" || variants.length >= 5}
          variant="outline"
          className="!py-1 text-xs"
        >
          {busy === "add" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          Add variant
        </Button>
        <select
          value={promoteId}
          onChange={(e) => setPromoteId(e.target.value)}
          className="rounded-lg border border-ink-600 bg-ink-800 px-2 py-1.5 text-xs text-zinc-100"
        >
          <option value="">Don&apos;t promote a winner</option>
          {nonControl.map((v) => (
            <option key={v.id} value={v.id}>
              Promote {v.label} to control
            </option>
          ))}
        </select>
        <Button onClick={() => endTest(promoteId || null)} disabled={busy === "end"} variant="outline" className="!py-1 text-xs">
          {busy === "end" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          End test
        </Button>
      </div>
    </div>
  );
}
