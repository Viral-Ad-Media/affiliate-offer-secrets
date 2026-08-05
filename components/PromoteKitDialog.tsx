"use client";

import { useState } from "react";
import { AlertTriangle, Loader2, Rocket } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { KIT_ASSETS, ALL_KIT_ASSETS, adsWithoutFunnel, type KitAssetKey } from "@/lib/kitAssets";
import { creditCostFor, formatCost } from "@/lib/credits";
import { Button } from "@/components/ui/button";

/**
 * Pick which pieces of the kit to generate before promoting.
 *
 * Every build used to produce all of them regardless — wasted generation for anyone who never runs
 * TikTok, or who only wants a funnel page. Defaults to everything, so the fast path is unchanged
 * for someone who just wants the lot: open, press Build.
 *
 * Used for a single product and for a bulk selection, with the same choices applied to each — the
 * alternative (per-product asset choices in one bulk action) is a spreadsheet, not a dialog.
 */
export default function PromoteKitDialog({
  open,
  onOpenChange,
  count,
  busy,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** How many products this will run against — 1 for the row button, N for the bulk bar. */
  count: number;
  busy: boolean;
  onConfirm: (assets: KitAssetKey[]) => void;
}) {
  const [selected, setSelected] = useState<KitAssetKey[]>([...ALL_KIT_ASSETS]);

  function toggle(key: KitAssetKey) {
    setSelected((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }

  const none = selected.length === 0;
  const warnNoFunnel = adsWithoutFunnel(selected);
  const unitCost = creditCostFor("build_campaign");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">
            {count > 1 ? `Build ${count} campaign kits` : "Build campaign kit"}
          </DialogTitle>
        </DialogHeader>

        <p className="text-xs text-zinc-500">
          Choose what to generate. Anything you leave out simply isn&apos;t written — you can
          rebuild later to add it.
        </p>

        <div className="mt-1 space-y-1.5">
          {KIT_ASSETS.map((a) => (
            <label
              key={a.key}
              className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-ink-700 p-2.5 hover:border-ink-600"
            >
              <input
                type="checkbox"
                checked={selected.includes(a.key)}
                onChange={() => toggle(a.key)}
                className="mt-0.5 accent-emerald-500"
              />
              <span className="min-w-0">
                <span className="block text-sm text-zinc-200">{a.label}</span>
                <span className="block text-[12px] text-zinc-500">{a.hint}</span>
              </span>
            </label>
          ))}
        </div>

        {warnNoFunnel && (
          <div className="mt-2 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              You&apos;ve chosen ads without a funnel page. Ads need somewhere to point — you can
              still send them straight to the vendor&apos;s sales page, but you&apos;ll capture no
              leads.
            </span>
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-ink-700 pt-3">
          {/* Flat price per kit regardless of how much is selected — the credit price is per build,
              not per asset. Generating less is faster and costs less real API spend, but it does
              not currently cost fewer credits, and saying so here beats letting someone discover
              it from the ledger. */}
          <span className="text-xs text-zinc-500">
            {count > 1 ? `${formatCost(unitCost * count)} (${count} × ${unitCost})` : formatCost(unitCost)}
            {" · price is per kit, not per item"}
          </span>
          <div className="flex items-center gap-2">
            <Button onClick={() => onOpenChange(false)} variant="outline" className="text-sm">
              Cancel
            </Button>
            <Button
              onClick={() => onConfirm(selected)}
              disabled={busy || none}
              title={none ? "Pick at least one thing to generate" : undefined} className="text-sm">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
              {count > 1 ? `Build ${count} kits` : "Build kit"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
