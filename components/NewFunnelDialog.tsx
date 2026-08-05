"use client";

import { useState } from "react";
import { ArrowLeft, FileText, Loader2, Lock, Sparkles } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FUNNEL_TYPES, MAX_FUNNEL_NAME, SUPPORT_REASON, funnelType, type FunnelStart } from "@/lib/funnelTypes";
import { FUNNEL_STYLES } from "@/lib/funnelStyles";

/**
 * Two steps: what kind of funnel, then what to call it and which layout to start from.
 *
 * There is deliberately no "which offer" step. A funnel is a page — a webinar registration, a lead
 * magnet, something to point ads at before an offer is even chosen — and demanding a product first
 * made people attach an arbitrary one to get past the dialog, which is worse data than none. An
 * offer can be attached later, on the funnel's own page, where the affiliate link actually matters.
 *
 * Types this app can't yet deliver are shown DISABLED with the reason, not hidden. Someone who came
 * looking for a survey funnel should find out it needs answer-based routing, rather than scan the
 * list, not see it, and assume they're looking in the wrong place.
 */
export default function NewFunnelDialog({
  open,
  onOpenChange,
  busy = false,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  busy?: boolean;
  onConfirm: (typeKey: string, name: string, start: FunnelStart) => void;
}) {
  const [step, setStep] = useState<"type" | "setup">("type");
  const [typeKey, setTypeKey] = useState<string | null>(null);
  const [name, setName] = useState("");

  const chosen = typeKey ? funnelType(typeKey) : null;
  const groups = Array.from(new Set(FUNNEL_TYPES.map((t) => t.group)));
  // Falls back to the type's own name so pressing straight through never creates an untitled
  // funnel — an unnamed row in a list is nobody's idea of a default.
  const finalName = name.trim() || chosen?.label || "Untitled funnel";

  function close(next: boolean) {
    onOpenChange(next);
    if (!next) {
      setStep("type");
      setTypeKey(null);
      setName("");
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base">
            {step === "type" ? "What kind of funnel?" : `Name it and pick a layout`}
          </DialogTitle>
        </DialogHeader>

        {step === "type" && (
          <div className="space-y-4">
            {groups.map((group) => (
              <div key={group}>
                <p className="mb-1.5 text-[12px] font-medium uppercase tracking-wide text-zinc-500">
                  {group}
                </p>
                <div className="space-y-1.5">
                  {FUNNEL_TYPES.filter((t) => t.group === group).map((t) => {
                    const locked = t.support !== "ready";
                    return (
                      <button
                        key={t.key}
                        type="button"
                        disabled={locked}
                        onClick={() => {
                          setTypeKey(t.key);
                          setStep("setup");
                        }}
                        className={`flex w-full items-start gap-2.5 rounded-lg border p-2.5 text-left ${
                          locked
                            ? "cursor-not-allowed border-ink-800 opacity-60"
                            : "border-ink-700 hover:border-emerald-500/60 hover:bg-ink-800/50"
                        }`}
                      >
                        {locked ? (
                          <Lock className="mt-0.5 h-4 w-4 shrink-0 text-zinc-600" />
                        ) : (
                          <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                        )}
                        <span className="min-w-0">
                          <span className="block text-sm text-zinc-200">{t.label}</span>
                          <span className="block text-[12px] text-zinc-500">{t.blurb}</span>
                          {locked && (
                            <span className="mt-1 block text-[11px] text-amber-300">
                              {SUPPORT_REASON[t.support as keyof typeof SUPPORT_REASON]}
                            </span>
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        {step === "setup" && chosen && (
          <div className="space-y-4">
            <label className="block">
              <span className="mb-1 block text-xs text-zinc-400">Funnel name</span>
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={MAX_FUNNEL_NAME}
                placeholder={chosen.label}
                className="w-full rounded-lg border border-ink-600 bg-ink-900 px-3 py-2 text-sm outline-none focus:border-emerald-500"
              />
              <span className="mt-1 block text-[11px] text-zinc-600">
                Just for your own list — visitors never see it.
              </span>
            </label>

            <div>
              <p className="mb-1.5 text-xs text-zinc-400">
                Layout · {chosen.label} + {chosen.steps.length === 1 ? "1 step" : `${chosen.steps.length} steps`}
              </p>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {FUNNEL_STYLES.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    disabled={busy}
                    onClick={() => onConfirm(chosen.key, finalName, s.id)}
                    className="rounded-lg border border-ink-700 p-2.5 text-left hover:border-emerald-500/60 hover:bg-ink-800/50 disabled:opacity-50"
                  >
                    <span className="block text-sm text-zinc-200">{s.label}</span>
                    <span className="mt-0.5 block text-[11px] leading-snug text-zinc-500">{s.blurb}</span>
                  </button>
                ))}
              </div>
            </div>

            <button
              type="button"
              disabled={busy}
              onClick={() => onConfirm(chosen.key, finalName, "scratch")}
              className="flex w-full items-start gap-2.5 rounded-lg border border-ink-700 p-2.5 text-left hover:border-emerald-500/60 hover:bg-ink-800/50 disabled:opacity-50"
            >
              <FileText className="mt-0.5 h-4 w-4 shrink-0 text-zinc-400" />
              <span>
                <span className="block text-sm text-zinc-200">Start from scratch</span>
                <span className="block text-[12px] text-zinc-500">
                  Empty pages with only the pieces that can&apos;t be removed — the opt-in form, the
                  affiliate disclosure and the call-to-action wiring.
                </span>
              </span>
            </button>

            <div className="flex items-center justify-between pt-1">
              <button
                type="button"
                onClick={() => setStep("type")}
                className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300"
              >
                <ArrowLeft className="h-3.5 w-3.5" /> Back
              </button>
              {busy && (
                <span className="flex items-center gap-1.5 text-xs text-zinc-400">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Creating…
                </span>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
