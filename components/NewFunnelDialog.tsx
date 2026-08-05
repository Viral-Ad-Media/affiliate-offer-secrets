"use client";

import { useState } from "react";
import { ArrowLeft, FileText, Loader2, Lock, Package, Sparkles } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  FUNNEL_TYPES,
  SUPPORT_REASON,
  funnelType,
  type FunnelStart,
} from "@/lib/funnelTypes";

export type FunnelProductOption = {
  id: string;
  title: string;
  /** Already has an opt-in page, so it already has a funnel — offered but not selectable. */
  hasFunnel: boolean;
};

/**
 * Three steps: which offer, what kind of funnel, and where its pages start from.
 *
 * Split rather than one long form because each question only makes sense once the previous one is
 * answered — "start from a template" means nothing until you know which funnel's template.
 *
 * The product step exists because a funnel isn't free-floating in this app: it's the opt-in page of
 * a campaign, and a campaign belongs to a product. Without an offer there's no affiliate link to
 * put behind the call to action, which is the one thing every one of these funnels exists to do.
 *
 * Types this app can't yet deliver are shown DISABLED with the reason, not hidden. Someone who came
 * looking for a webinar funnel should find out that it needs a video block, rather than scan the
 * list, not see it, and assume they're looking in the wrong place.
 */
export default function NewFunnelDialog({
  open,
  onOpenChange,
  products,
  busy = false,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  products: FunnelProductOption[];
  busy?: boolean;
  onConfirm: (productId: string, typeKey: string, start: FunnelStart) => void;
}) {
  const [step, setStep] = useState<"product" | "type" | "start">("product");
  const [productId, setProductId] = useState<string | null>(null);
  const [typeKey, setTypeKey] = useState<string | null>(null);

  const chosen = typeKey ? funnelType(typeKey) : null;
  const product = products.find((p) => p.id === productId) ?? null;
  const groups = Array.from(new Set(FUNNEL_TYPES.map((t) => t.group)));

  function close(next: boolean) {
    onOpenChange(next);
    if (!next) {
      // Reset on close so reopening starts at step one rather than mid-flow.
      setStep("product");
      setProductId(null);
      setTypeKey(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base">
            {step === "product"
              ? "Which offer is this funnel for?"
              : step === "type"
                ? "What kind of funnel?"
                : `${chosen?.label}: where do the pages start?`}
          </DialogTitle>
        </DialogHeader>

        {step === "product" && (
          <div className="space-y-3">
            {products.length === 0 ? (
              <p className="py-6 text-center text-sm text-zinc-500">
                No offers yet. Add one from the Marketplace first — a funnel needs an affiliate link
                to send people to.
              </p>
            ) : (
              <div className="space-y-1.5">
                {products.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    disabled={p.hasFunnel}
                    onClick={() => {
                      setProductId(p.id);
                      setStep("type");
                    }}
                    className={`flex w-full items-start gap-2.5 rounded-lg border p-2.5 text-left ${
                      p.hasFunnel
                        ? "cursor-not-allowed border-ink-800 opacity-60"
                        : "border-ink-700 hover:border-emerald-500/60 hover:bg-ink-800/50"
                    }`}
                  >
                    <Package className="mt-0.5 h-4 w-4 shrink-0 text-zinc-500" />
                    <span className="min-w-0">
                      <span className="block truncate text-sm text-zinc-200">{p.title}</span>
                      {p.hasFunnel && (
                        <span className="block text-[11px] text-amber-300">
                          Already has a funnel — open it from the list instead
                        </span>
                      )}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

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
                          setStep("start");
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
            <button
              type="button"
              onClick={() => setStep("product")}
              className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Back
            </button>
          </div>
        )}

        {step === "start" && chosen && product && (
          <div className="space-y-3">
            <p className="text-xs text-zinc-500">
              For <span className="text-zinc-300">{product.title}</span>. {chosen.blurb} Creates the
              opt-in page plus{" "}
              {chosen.steps.length === 1 ? "one step" : `${chosen.steps.length} steps`} after it.
            </p>

            <button
              type="button"
              disabled={busy}
              onClick={() => onConfirm(product.id, chosen.key, "template")}
              className="flex w-full items-start gap-2.5 rounded-lg border border-ink-700 p-3 text-left hover:border-emerald-500/60 hover:bg-ink-800/50"
            >
              <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
              <span>
                <span className="block text-sm text-zinc-200">Use a template</span>
                <span className="block text-[12px] text-zinc-500">
                  Pages come pre-built for a {chosen.label.toLowerCase()} — headline, sections and
                  calls to action already in place, ready to edit.
                </span>
              </span>
            </button>

            <button
              type="button"
              disabled={busy}
              onClick={() => onConfirm(product.id, chosen.key, "scratch")}
              className="flex w-full items-start gap-2.5 rounded-lg border border-ink-700 p-3 text-left hover:border-emerald-500/60 hover:bg-ink-800/50"
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
