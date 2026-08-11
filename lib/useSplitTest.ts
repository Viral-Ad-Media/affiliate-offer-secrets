"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { BridgeVariant } from "@/lib/shared";

// The variants/leadCounts state and the RPC calls behind a split test (start/add/weight/toggle/
// delete/end), in one place.
//
// It was extracted when there were two consumers — a detailed list inside the opt-in editor and
// the branch on the funnel map — so neither could drift from the other's read-after-write and
// error-handling behaviour. The list is gone (the map branch does everything it did, and one test
// shown in two places was a way to see two different answers), leaving
// components/SplitTestBranch.tsx as the only caller. Kept as a hook rather than folded back in:
// it is the whole data layer of the feature, and inlining it would bury the RPC surface in a
// component that is mostly layout.
export type LeadCounts = Record<string, number>;

export function useSplitTest(campaignId: string) {
  const [variants, setVariants] = useState<BridgeVariant[] | null>(null);
  const [leadCounts, setLeadCounts] = useState<LeadCounts>({});
  const [weights, setWeights] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      return false;
    }
    await load();
    return true;
  }

  async function endTest(promoteVariantId: string | null) {
    setBusy("end");
    setError(null);
    const { error: err } = await createClient().rpc("end_bridge_split_test", {
      p_campaign_id: campaignId,
      p_promote_variant_id: promoteVariantId || null,
    });
    setBusy(null);
    if (err) {
      setError(err.message);
      return false;
    }
    await load();
    return true;
  }

  return {
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
    deleteVariant,
    endTest,
  };
}
