"use client";

import { useState } from "react";
import { Settings2 } from "lucide-react";
import TrackingPanel from "@/components/TrackingPanel";
import type { TrackingSettings } from "@/lib/engine/renderPages";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Funnel-level settings, behind a ⚙ on the funnel map.
 *
 * Tracking and its consent gate describe the WHOLE funnel — they install on the opt-in page, every
 * split-test variant and every step — so they belong beside the funnel, not stacked underneath the
 * map as a permanent form. Below a map with several pages on it, a tall panel of IDs you set once
 * and rarely revisit was the last thing on screen and the first thing in the way.
 *
 * This mirrors the canvas ⚙ the page editors already have (`WysiwygCanvas`'s `settings` prop): the
 * same idea one level up — that one holds settings for the PAGE, this one for the FUNNEL.
 *
 * `PublishBridge` deliberately stays on the page. It is an action with a live consequence, not a
 * setting, and burying "is this funnel public" behind a gear is how someone ships a page they
 * meant to keep private.
 */
export default function FunnelSettingsDialog({
  campaignId,
  tracking,
  onSaved,
  triggerClassName,
}: {
  campaignId: string;
  tracking: TrackingSettings | null;
  /** Refresh the campaign row — see the note on TrackingPanel's own `onSaved`. */
  onSaved: () => void;
  /** Overrides the trigger's look — the funnels LIST hosts this in its icon-action row. */
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Funnel settings"
        aria-label="Funnel settings"
        className={triggerClassName ?? cn(buttonVariants({ variant: "outline" }), "!px-2 !py-1.5")}
      >
        <Settings2 className="h-4 w-4" />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        {/* Tall content — the tracking form plus the consent fields runs past a short viewport, so
            the dialog scrolls rather than clipping its own Save button off the bottom. */}
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-base">Funnel settings</DialogTitle>
          </DialogHeader>
          <p className="-mt-1 text-xs text-zinc-500">
            Applies to every page in this funnel — the opt-in page, any split-test variants, and
            each step.
          </p>
          <TrackingPanel campaignId={campaignId} initialTracking={tracking} bare allowRawSnippets onSaved={onSaved} />
        </DialogContent>
      </Dialog>
    </>
  );
}
