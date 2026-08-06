"use client";

import { useState } from "react";
import { Loader2, Palette, Check } from "lucide-react";
import { toast } from "@/lib/toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { THEME_PRESETS, THEME_DEFAULTS } from "@/lib/engine/pageTheme";
import { Button } from "@/components/ui/button";

/**
 * Change how a funnel LOOKS without regenerating a word of it.
 *
 * The counterpart to regenerating: a preset only writes `page_copy.theme`, which becomes CSS
 * custom properties at render time. No block is added, removed or reordered, so this is safe on a
 * page somebody hand-wrote — which is precisely what rebuilding the funnel page is not. Free, too:
 * no Anthropic call, so no credits.
 *
 * Swatches are drawn from the preset's own colours rather than a screenshot, so a preset added to
 * lib/engine/pageTheme.ts shows up here correctly with no second thing to update.
 */
export default function RestyleDialog({
  open,
  onOpenChange,
  campaignId,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campaignId: string;
  onDone?: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);

  async function apply(presetId: string) {
    setBusy(presetId);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/restyle`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ preset: presetId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Couldn't apply that style.");
        return;
      }
      toast.success("Design updated — your copy is unchanged.");
      onOpenChange(false);
      onDone?.();
    } catch {
      toast.error("Couldn't apply that style.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Palette className="h-4 w-4 text-emerald-400" /> Change the design
          </DialogTitle>
        </DialogHeader>

        <p className="text-xs text-zinc-500">
          Colours, type and button shape only — every word on the page stays exactly as it is. Free,
          and it applies to the opt-in page, any split-test variants and every step.
        </p>

        <div className="mt-1 grid gap-2 sm:grid-cols-2">
          {THEME_PRESETS.map((p) => {
            const c = p.theme.colors;
            const bg = c?.background ?? THEME_DEFAULTS.background;
            const primary = c?.primary ?? THEME_DEFAULTS.primary;
            const text = c?.text ?? THEME_DEFAULTS.text;
            return (
              <button
                key={p.id}
                type="button"
                disabled={busy !== null}
                onClick={() => apply(p.id)}
                className="group flex flex-col gap-2 rounded-lg border border-ink-700 p-3 text-left hover:border-emerald-500 disabled:opacity-50"
              >
                <span className="flex items-center gap-2">
                  {/* A miniature of the real page: background, a line of text, the CTA. */}
                  <span
                    className="flex h-9 w-14 shrink-0 flex-col justify-center gap-1 rounded border border-ink-600 px-1.5"
                    style={{ background: bg }}
                  >
                    <span className="block h-1 w-8 rounded-full" style={{ background: text }} />
                    <span className="block h-2.5 w-full rounded-sm" style={{ background: primary }} />
                  </span>
                  <span className="text-sm font-medium text-zinc-200">{p.label}</span>
                  {busy === p.id && <Loader2 className="ml-auto h-3.5 w-3.5 animate-spin text-zinc-400" />}
                  {busy === null && (
                    <Check className="ml-auto h-3.5 w-3.5 text-emerald-400 opacity-0 group-hover:opacity-100" />
                  )}
                </span>
                <span className="text-[12px] leading-snug text-zinc-500">{p.blurb}</span>
              </button>
            );
          })}
        </div>

        <div className="mt-2 flex justify-end border-t border-ink-700 pt-3">
          <Button onClick={() => onOpenChange(false)} variant="outline" className="text-sm">
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
