"use client";

import { useState } from "react";
import { Beaker, Loader2, Pause, Play, Plus, Trash2, Pencil, X, Eye } from "lucide-react";
import { useSplitTest } from "@/lib/useSplitTest";
import PageEditor from "@/components/PageEditor";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export default function SplitTestPanel({
  campaignId,
  productTitle,
}: {
  campaignId: string;
  productTitle: string;
}) {
  const {
    variants,
    leadCounts,
    weights,
    setWeights,
    busy,
    error,
    load,
    startTest,
    addVariant,
    commitWeight,
    toggleStatus,
    deleteVariant: deleteVariantRaw,
    endTest: endTestRaw,
  } = useSplitTest(campaignId);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [promoteId, setPromoteId] = useState<string>("");

  async function deleteVariant(variantId: string) {
    const ok = await deleteVariantRaw(variantId);
    if (ok && editingId === variantId) setEditingId(null);
  }

  async function endTest() {
    const ok = await endTestRaw(promoteId || null);
    if (ok) {
      setEditingId(null);
      setPromoteId("");
    }
  }

  if (variants === null) return null;

  const editingVariant = variants.find((v) => v.id === editingId) ?? null;
  const nonControl = variants.filter((v) => !v.is_control);

  return (
    <div className="mb-3 rounded-lg border border-ink-700 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
          <Beaker className="h-4 w-4 text-emerald-400" /> Split test
        </div>
        {variants.length === 0 && (
          <Button onClick={startTest} disabled={busy === "start"}>
            {busy === "start" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Start split test
          </Button>
        )}
      </div>
      {error && <p className="mt-2 text-sm text-red-300">{error}</p>}

      {variants.length === 0 ? (
        <p className="mt-2 text-xs text-zinc-500">
          Not running — the page above is served to 100% of visitors. Starting a test adds a "B"
          variant seeded from the current copy, so you can edit it and compare.
        </p>
      ) : (
        <div className="mt-3 space-y-2">
          {variants.map((v) => {
            const leads = leadCounts[v.id] ?? 0;
            const rate = v.views > 0 ? ((leads / v.views) * 100).toFixed(1) : "—";
            return (
              <div key={v.id} className="rounded-lg border border-ink-700 p-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-zinc-100">
                      {v.label}
                      {v.is_control && <span className="ml-1 text-xs text-zinc-500">(control)</span>}
                    </span>
                    <Badge
                      className={
                        v.status === "active"
                          ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-300"
                          : "border-ink-600 bg-ink-800 text-zinc-400"
                      }>
                      {v.status}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <label className="flex items-center gap-1 text-xs text-zinc-500">
                      Weight
                      <input
                        type="number"
                        min={1}
                        max={100}
                        value={weights[v.id] ?? v.weight}
                        onChange={(e) =>
                          setWeights((w) => ({ ...w, [v.id]: Number(e.target.value) || 1 }))
                        }
                        onBlur={() => weights[v.id] !== v.weight && commitWeight(v.id)}
                        className="w-16 rounded-lg border border-ink-600 bg-ink-800 px-2 py-1 text-xs text-zinc-100"
                      />
                    </label>
                    <Button
                      onClick={() => toggleStatus(v)}
                      disabled={busy === v.id}
                      title={v.status === "active" ? "Pause" : "Resume"} variant="outline" className="!px-2 !py-1">
                      {v.status === "active" ? (
                        <Pause className="h-3.5 w-3.5" />
                      ) : (
                        <Play className="h-3.5 w-3.5" />
                      )}
                    </Button>
                    {!v.is_control && (
                      <>
                        <Button
                          onClick={() => setEditingId(editingId === v.id ? null : v.id)}
                          
                          title="Edit copy" variant="outline" className="!px-2 !py-1">
                          {editingId === v.id ? (
                            <X className="h-3.5 w-3.5" />
                          ) : (
                            <Pencil className="h-3.5 w-3.5" />
                          )}
                        </Button>
                        <Button
                          onClick={() => deleteVariant(v.id)}
                          disabled={busy === v.id}
                          
                          title="Delete variant" variant="outline" className="!px-2 !py-1 hover:text-red-300">
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </>
                    )}
                  </div>
                </div>
                <div className="mt-1.5 flex items-center gap-4 text-xs text-zinc-500">
                  <span className="flex items-center gap-1">
                    <Eye className="h-3 w-3" /> {v.views} views
                  </span>
                  <span>{leads} leads</span>
                  <span>{rate === "—" ? rate : `${rate}%`} rate</span>
                  {v.is_control && (
                    <span className="text-zinc-600">Edit via the section above</span>
                  )}
                </div>
              </div>
            );
          })}

          {editingVariant && (
            <div className="rounded-lg border border-ink-700 p-3">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Editing {editingVariant.label}
              </div>
              <PageEditor
                campaignId={campaignId}
                productTitle={productTitle}
                initialCopy={editingVariant.page_copy}
                initialBridgeHtml={editingVariant.bridge_html}
                saveEndpoint={`/api/bridge-variants/${editingVariant.id}`}
                onSaved={() => load()}
              />
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button
              onClick={addVariant}
              disabled={busy === "add" || variants.length >= 5} variant="outline" className="!py-1 text-xs">
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
              <Button onClick={endTest} disabled={busy === "end"} variant="outline" className="!py-1 text-xs">
                {busy === "end" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                End test
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
