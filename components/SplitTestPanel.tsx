"use client";

import { useCallback, useEffect, useState } from "react";
import { Beaker, Loader2, Pause, Play, Plus, Trash2, Pencil, X, Eye } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { BridgeVariant } from "@/lib/shared";
import PageEditor from "@/components/PageEditor";

type LeadCounts = Record<string, number>;

export default function SplitTestPanel({
  campaignId,
  productTitle,
  previewHoplink,
}: {
  campaignId: string;
  productTitle: string;
  previewHoplink: string;
}) {
  const [variants, setVariants] = useState<BridgeVariant[] | null>(null);
  const [leadCounts, setLeadCounts] = useState<LeadCounts>({});
  const [weights, setWeights] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [promoteId, setPromoteId] = useState<string>("");

  const load = useCallback(async () => {
    const supabase = createClient();
    const [{ data: rows }, { data: contacts }] = await Promise.all([
      supabase.from("bridge_variants").select("*").eq("campaign_id", campaignId).order("created_at"),
      supabase.from("contacts").select("bridge_variant_id").eq("campaign_id", campaignId),
    ]);
    const v = (rows ?? []) as BridgeVariant[];
    setVariants(v);
    setWeights(Object.fromEntries(v.map((r) => [r.id, r.weight])));
    const counts: LeadCounts = {};
    for (const c of contacts ?? []) {
      if (!c.bridge_variant_id) continue;
      counts[c.bridge_variant_id] = (counts[c.bridge_variant_id] ?? 0) + 1;
    }
    setLeadCounts(counts);
  }, [campaignId]);

  useEffect(() => {
    load();
  }, [load]);

  async function startTest() {
    setBusy("start");
    setError(null);
    const { error: err } = await createClient().rpc("start_bridge_split_test", { p_campaign_id: campaignId });
    setBusy(null);
    if (err) {
      setError(err.message);
      return;
    }
    await load();
  }

  async function addVariant() {
    setBusy("add");
    setError(null);
    const { error: err } = await createClient().rpc("add_bridge_variant", { p_campaign_id: campaignId });
    setBusy(null);
    if (err) {
      setError(err.message);
      return;
    }
    await load();
  }

  async function commitWeight(variantId: string) {
    const weight = weights[variantId];
    setBusy(variantId);
    const { error: err } = await createClient().rpc("update_bridge_variant_weight", {
      p_variant_id: variantId,
      p_weight: weight,
    });
    setBusy(null);
    if (err) setError(err.message);
    else await load();
  }

  async function toggleStatus(variant: BridgeVariant) {
    setBusy(variant.id);
    const fn = variant.status === "active" ? "pause_bridge_variant" : "resume_bridge_variant";
    const { error: err } = await createClient().rpc(fn, { p_variant_id: variant.id });
    setBusy(null);
    if (err) setError(err.message);
    else await load();
  }

  async function deleteVariant(variantId: string) {
    setBusy(variantId);
    const { error: err } = await createClient().rpc("delete_bridge_variant", { p_variant_id: variantId });
    setBusy(null);
    if (err) {
      setError(err.message);
      return;
    }
    if (editingId === variantId) setEditingId(null);
    await load();
  }

  async function endTest() {
    setBusy("end");
    setError(null);
    const { error: err } = await createClient().rpc("end_bridge_split_test", {
      p_campaign_id: campaignId,
      p_promote_variant_id: promoteId || null,
    });
    setBusy(null);
    if (err) {
      setError(err.message);
      return;
    }
    setEditingId(null);
    setPromoteId("");
    await load();
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
          <button onClick={startTest} disabled={busy === "start"} className="btn-primary">
            {busy === "start" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Start split test
          </button>
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
                    <span
                      className={`chip ${
                        v.status === "active"
                          ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-300"
                          : "border-ink-600 bg-ink-800 text-zinc-400"
                      }`}
                    >
                      {v.status}
                    </span>
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
                    <button
                      onClick={() => toggleStatus(v)}
                      disabled={busy === v.id}
                      title={v.status === "active" ? "Pause" : "Resume"}
                      className="btn-ghost !px-2 !py-1"
                    >
                      {v.status === "active" ? (
                        <Pause className="h-3.5 w-3.5" />
                      ) : (
                        <Play className="h-3.5 w-3.5" />
                      )}
                    </button>
                    {!v.is_control && (
                      <>
                        <button
                          onClick={() => setEditingId(editingId === v.id ? null : v.id)}
                          className="btn-ghost !px-2 !py-1"
                          title="Edit copy"
                        >
                          {editingId === v.id ? (
                            <X className="h-3.5 w-3.5" />
                          ) : (
                            <Pencil className="h-3.5 w-3.5" />
                          )}
                        </button>
                        <button
                          onClick={() => deleteVariant(v.id)}
                          disabled={busy === v.id}
                          className="btn-ghost !px-2 !py-1 hover:text-red-300"
                          title="Delete variant"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
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
                previewHoplink={previewHoplink}
                saveEndpoint={`/api/bridge-variants/${editingVariant.id}`}
                onSaved={() => load()}
              />
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              onClick={addVariant}
              disabled={busy === "add" || variants.length >= 5}
              className="btn-ghost !py-1 text-xs"
            >
              {busy === "add" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              Add variant
            </button>
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
              <button onClick={endTest} disabled={busy === "end"} className="btn-ghost !py-1 text-xs">
                {busy === "end" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                End test
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
