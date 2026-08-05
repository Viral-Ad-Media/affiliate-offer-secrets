"use client";

import { useState } from "react";
import { Beaker, Eye, Pencil, Pause, Play, Plus, Trash2, LogIn, Loader2 } from "lucide-react";
import { useSplitTest } from "@/lib/useSplitTest";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

// Renders the opt-in page's position in the funnel map (components/FunnelMap.tsx) — either as a
// single plain node (no test running, the ~100% common case) or, once a split test is started, as
// a visual branch: parallel variant cards that represent the real weighted-random split a visitor
// actually experiences (lib/bridgeVariants.ts's pickWeightedVariant), merging back into the same
// single funnel path below. This is the map-integrated counterpart to components/SplitTestPanel.tsx
// (the detailed vertical list shown on the opt-in page's own focused editor view) — both share
// lib/useSplitTest.ts so neither can drift on data/mutation behavior; this component only differs
// in layout (compact horizontal cards, no inline per-variant editor — editing routes back to the
// parent page's own view-switching via onEditVariant/onEditControl) and in owning the "no test yet"
// empty state itself, so FunnelMap never needs its own awareness of whether a test is running.
export default function SplitTestBranch({
  campaignId,
  bridgeHtml,
  onPreview,
  onEditControl,
  onEditVariant,
}: {
  campaignId: string;
  bridgeHtml: string | null;
  onPreview: (html: string | null, title: string) => void;
  onEditControl: () => void;
  onEditVariant: (variantId: string) => void;
}) {
  const { variants, leadCounts, weights, setWeights, busy, error, startTest, addVariant, commitWeight, toggleStatus, deleteVariant, endTest } =
    useSplitTest(campaignId);
  const [promoteId, setPromoteId] = useState<string>("");

  if (variants === null) return null;

  if (variants.length === 0) {
    // No test running — the plain single-node look, matching every other MapNode in the funnel,
    // plus a "Start split test" affordance so starting one doesn't require leaving the map first.
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-ink-700 bg-ink-800/60 p-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-full border border-ink-600 bg-ink-900 text-emerald-400">
            <LogIn className="h-4 w-4" />
          </span>
          <div>
            <div className="text-sm font-medium text-zinc-100">Opt-in page</div>
            <div className="text-xs text-zinc-500">Every funnel's entry point — lead capture</div>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <Button onClick={() => onPreview(bridgeHtml, "Opt-in page")}  title="Preview" variant="outline" className="!px-2 !py-1">
            <Eye className="h-3.5 w-3.5" />
          </Button>
          <Button onClick={onEditControl}  title="Edit" variant="outline" className="!px-2 !py-1">
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button onClick={startTest} disabled={busy === "start"}  title="Start a split test" variant="outline" className="!px-2 !py-1 text-xs">
            {busy === "start" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Beaker className="h-3.5 w-3.5" />}
            Split test
          </Button>
        </div>
        {error && <p className="w-full text-xs text-red-300">{error}</p>}
      </div>
    );
  }

  const nonControl = variants.filter((v) => !v.is_control);

  return (
    <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/[0.03] p-3">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-emerald-300">
        <Beaker className="h-3.5 w-3.5" /> Split test running — traffic is split across {variants.length} variants
      </div>
      {error && <p className="mb-2 text-xs text-red-300">{error}</p>}

      <div className="flex flex-wrap gap-2">
        {variants.map((v) => {
          const leads = leadCounts[v.id] ?? 0;
          const rate = v.views > 0 ? ((leads / v.views) * 100).toFixed(1) : "—";
          return (
            <div key={v.id} className="min-w-[180px] flex-1 rounded-lg border border-ink-700 bg-ink-900 p-2.5">
              <div className="flex items-center justify-between gap-1.5">
                <span className="text-sm font-medium text-zinc-100">
                  {v.label}
                  {v.is_control && <span className="ml-1 text-xs text-zinc-500">(control)</span>}
                </span>
                <Badge
                  className={`!px-1.5 !py-0.5 ${
                    v.status === "active" ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-300" : "border-ink-600 bg-ink-800 text-zinc-400"
                  }`}>
                  {v.status}
                </Badge>
              </div>
              <div className="mt-1 flex items-center gap-2 text-xs text-zinc-500">
                <label className="flex items-center gap-1">
                  Wt
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={weights[v.id] ?? v.weight}
                    onChange={(e) => setWeights((w) => ({ ...w, [v.id]: Number(e.target.value) || 1 }))}
                    onBlur={() => weights[v.id] !== v.weight && commitWeight(v.id)}
                    className="w-12 rounded border border-ink-600 bg-ink-800 px-1 py-0.5 text-xs text-zinc-100"
                  />
                </label>
                <span>{v.views} views</span>
                <span>{leads} leads</span>
                <span>{rate === "—" ? rate : `${rate}%`}</span>
              </div>
              <div className="mt-1.5 flex items-center gap-1">
                <Button
                  onClick={() => onPreview(v.is_control ? bridgeHtml : v.bridge_html, v.label)}
                  
                  title="Preview" variant="outline" className="!px-1.5 !py-1">
                  <Eye className="h-3 w-3" />
                </Button>
                <Button
                  onClick={() => (v.is_control ? onEditControl() : onEditVariant(v.id))}
                  
                  title="Edit copy" variant="outline" className="!px-1.5 !py-1">
                  <Pencil className="h-3 w-3" />
                </Button>
                <Button
                  onClick={() => toggleStatus(v)}
                  disabled={busy === v.id}
                  title={v.status === "active" ? "Pause" : "Resume"} variant="outline" className="!px-1.5 !py-1">
                  {v.status === "active" ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                </Button>
                {!v.is_control && (
                  <Button
                    onClick={() => deleteVariant(v.id)}
                    disabled={busy === v.id}
                    
                    title="Delete variant" variant="outline" className="!px-1.5 !py-1 hover:text-red-300">
                    <Trash2 className="h-3 w-3" />
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button onClick={addVariant} disabled={busy === "add" || variants.length >= 5} variant="outline" className="!py-1 text-xs">
          {busy === "add" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          Add variant
        </Button>
        <div className="ml-auto flex items-center gap-2">
          <select
            value={promoteId}
            onChange={(e) => setPromoteId(e.target.value)}
            className="rounded-lg border border-ink-600 bg-ink-800 px-2 py-1.5 text-xs text-zinc-100"
          >
            <option value="">Don't promote a winner</option>
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
    </div>
  );
}
