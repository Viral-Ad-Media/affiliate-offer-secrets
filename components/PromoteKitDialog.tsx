"use client";

import { useState } from "react";
import { AlertTriangle, Loader2, Rocket, RefreshCw, ShieldCheck } from "lucide-react";
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
 *
 * REGENERATE is the same dialog with one changed default, not a second component: the pieces you
 * can regenerate are exactly the pieces you could build, and two dialogs would drift the first time
 * an asset was added to only one of them.
 *
 * The one real difference is the funnel page. Rebuilding it overwrites `page_copy` — including copy
 * somebody wrote by hand on a page that may already be taking paid traffic — so in regenerate mode
 * it starts UNTICKED and ticking it shows a warning. That default holds whether or not we know the
 * page was edited: `page_copy_edited_at` (0076) is null for anything edited before that column
 * existed, so trusting it as the guard would silently destroy exactly the oldest, most worked-on
 * pages. It sharpens the wording; it is not the safety mechanism.
 */
export default function PromoteKitDialog({
  open,
  onOpenChange,
  count,
  busy,
  onConfirm,
  mode = "build",
  funnelEditedAt = null,
  onRestyle,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** How many products this will run against — 1 for the row button, N for the bulk bar. */
  count: number;
  busy: boolean;
  onConfirm: (assets: KitAssetKey[]) => void;
  /** "regenerate" changes the copy and unticks the funnel page by default. */
  mode?: "build" | "regenerate";
  /** ISO date of the last hand edit, when known — sharpens the warning, never gates it. */
  funnelEditedAt?: string | null;
  /** Offered as the non-destructive alternative. Absent in bulk, where there's no one page to restyle. */
  onRestyle?: () => void;
}) {
  const regenerate = mode === "regenerate";
  const [selected, setSelected] = useState<KitAssetKey[]>(
    regenerate ? ALL_KIT_ASSETS.filter((k) => k !== "funnel") : [...ALL_KIT_ASSETS]
  );

  function toggle(key: KitAssetKey) {
    setSelected((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }

  const none = selected.length === 0;
  // In regenerate mode the funnel page starts off, so "ads without a funnel" is the normal state
  // rather than a mistake — the page already exists. Showing that warning here would train people
  // to ignore it, which is the one thing a warning must not do.
  const warnNoFunnel = !regenerate && adsWithoutFunnel(selected);
  const willReplaceFunnel = regenerate && selected.includes("funnel");
  const unitCost = creditCostFor("build_campaign");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">
            {regenerate
              ? count > 1
                ? `Regenerate ${count} kits`
                : "Regenerate kit"
              : count > 1
                ? `Build ${count} campaign kits`
                : "Build campaign kit"}
          </DialogTitle>
        </DialogHeader>

        <p className="text-xs text-zinc-500">
          {regenerate
            ? "Whatever you tick is written fresh and replaces what's there now. Anything you leave unticked is kept exactly as it is."
            : "Choose what to generate. Anything you leave out simply isn't written — you can rebuild later to add it."}
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

        {regenerate && !willReplaceFunnel && (
          <div className="mt-2 flex items-start gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              Your funnel page and any edits to it are left alone.
              {onRestyle && (
                <>
                  {" "}
                  Want it to <em>look</em> different?{" "}
                  <button type="button" onClick={onRestyle} className="underline hover:text-emerald-200">
                    Change the design instead
                  </button>{" "}
                  — that costs no credits and rewrites nothing.
                </>
              )}
            </span>
          </div>
        )}

        {willReplaceFunnel && (
          <div className="mt-2 flex items-start gap-2 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              This overwrites the funnel page copy
              {funnelEditedAt
                ? `, including the edits made on ${new Date(funnelEditedAt).toLocaleDateString()}`
                : " and any edits made to it"}
              . There is no undo.
              {onRestyle && (
                <>
                  {" "}
                  To change only how it looks,{" "}
                  <button type="button" onClick={onRestyle} className="underline hover:text-red-200">
                    change the design instead
                  </button>
                  .
                </>
              )}
            </span>
          </div>
        )}

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
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : regenerate ? (
                <RefreshCw className="h-4 w-4" />
              ) : (
                <Rocket className="h-4 w-4" />
              )}
              {regenerate
                ? count > 1
                  ? `Regenerate ${count} kits`
                  : "Regenerate"
                : count > 1
                  ? `Build ${count} kits`
                  : "Build kit"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
