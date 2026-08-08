"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, AlertTriangle, Info, X } from "lucide-react";
import { subscribeToasts, dismissToast, type Toast } from "@/lib/toast";

// Only the shades tailwind.config.ts remaps through CSS variables are theme-aware — emerald
// 200-400, red 300-400, zinc 100-600. Reaching for an unmapped shade (red-200) silently falls back
// to Tailwind's stock pale value, which vanishes against a light background.
const STYLE: Record<Toast["kind"], { cls: string; Icon: typeof CheckCircle2 }> = {
  success: { cls: "border-emerald-500/30 bg-emerald-500/15 text-emerald-300", Icon: CheckCircle2 },
  error: { cls: "border-red-500/30 bg-red-500/15 text-red-300", Icon: AlertTriangle },
  info: { cls: "border-ink-600 bg-ink-800 text-zinc-100", Icon: Info },
};

// Mounted once in the root layout. Fixed to the viewport with a high z-index so it sits above the
// full-screen editors and dialogs, which are the surfaces most likely to be firing toasts.
//
// pointer-events-none on the stack, auto on each toast: the strip spans a corner of the screen and
// must not swallow clicks on whatever is underneath it between toasts.
export default function Toaster() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => subscribeToasts(setToasts), []);

  if (toasts.length === 0) return null;

  return (
    // Top centre. `left-1/2 -translate-x-1/2` rather than `inset-x-0 mx-auto`, so the strip is
    // only as wide as the toasts themselves — a full-width container would sit invisibly over the
    // top bar, and `pointer-events-none` protects clicks but not hover states underneath it.
    // Newest is still first in the array, which now reads correctly: the newest toast is the one
    // nearest the top of the screen, where the eye already is.
    <div className="pointer-events-none fixed left-1/2 top-4 z-[100] flex w-[min(24rem,calc(100vw-2rem))] -translate-x-1/2 flex-col gap-2">
      {toasts.map((t) => {
        const { cls, Icon } = STYLE[t.kind];
        return (
          <div
            key={t.id}
            // Errors interrupt; everything else waits for a pause in what the reader is doing.
            role={t.kind === "error" ? "alert" : "status"}
            aria-live={t.kind === "error" ? "assertive" : "polite"}
            className={`pointer-events-auto flex items-start gap-2 rounded-lg border px-3 py-2 text-sm shadow-lg ${cls}`}
          >
            <Icon className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="min-w-0 flex-1 break-words">{t.message}</span>
            <button
              type="button"
              onClick={() => dismissToast(t.id)}
              title="Dismiss"
              className="shrink-0 opacity-60 hover:opacity-100"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
