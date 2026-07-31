"use client";

import { useState } from "react";
import { ChevronDown, Check, Globe, FileText, Loader2 } from "lucide-react";

export type PublishStatus = "published" | "draft";

const OPTIONS = [
  { value: "published" as const, label: "Published", icon: Globe },
  { value: "draft" as const, label: "Draft", icon: FileText },
];

// One button labelled with the current status, chevron inside it, opening a menu of both states.
// Replaces the old publish/unpublish toggle: switching back to Draft is now in the same place
// whichever state you're in, instead of an "Unpublish" button that only exists once you're live.
//
// Shared by the blog post editor and the funnel's publish panel so the two can't drift.
export default function StatusDropdownButton({
  status,
  busy = false,
  onChange,
  className = "btn-primary flex items-center gap-1.5 text-xs",
}: {
  status: PublishStatus;
  busy?: boolean;
  /** Called only when the picked status differs from the current one. */
  onChange: (next: PublishStatus) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  function pick(next: PublishStatus) {
    setOpen(false);
    if (next !== status) onChange(next);
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={busy}
        title="Change status"
        aria-haspopup="menu"
        aria-expanded={open}
        className={className}
      >
        {busy ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : status === "published" ? (
          <Globe className="h-3.5 w-3.5" />
        ) : null}
        {status === "published" ? "Published" : "Publish"}
        <ChevronDown className="h-3.5 w-3.5 opacity-80" />
      </button>

      {open && (
        <>
          {/* Click-away layer rather than a document listener — nothing to leak on unmount. */}
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div
            role="menu"
            className="absolute right-0 z-20 mt-1 w-44 overflow-hidden rounded-lg border border-ink-700 bg-ink-900 py-1 shadow-lg"
          >
            {OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                role="menuitem"
                onClick={() => pick(o.value)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-zinc-200 hover:bg-ink-800"
              >
                <o.icon className="h-3.5 w-3.5 text-zinc-500" />
                <span className="flex-1">{o.label}</span>
                {status === o.value && <Check className="h-3.5 w-3.5 text-emerald-400" />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
