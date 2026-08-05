"use client";

import { useState } from "react";
import { ChevronDown, Check, Loader2 } from "lucide-react";
import { PRODUCT_STATUSES, STATUS_COLORS, type ProductStatus } from "@/lib/shared";
import { toast } from "@/lib/toast";
import { badgeVariants } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// The status chip itself is the control. Until now Selected/Paused/Dead appeared in the filter but
// nothing could ever set them — the engine only writes "New" on discovery and "Promoting" when a
// kit finishes, so three of the five statuses were unreachable.
//
// Same one-button-with-chevron shape as StatusDropdownButton (publish/draft), kept as a separate
// component rather than generalising that one: this renders as a coloured status chip inside a
// dense table row, that one renders as a primary action button. Merging them would mean a
// component that's mostly branches.
export default function ProductStatusSelect({
  productId,
  status,
  onChanged,
}: {
  productId: string;
  status: ProductStatus | string;
  /** Called after a successful write so the caller can refresh its own copy of the row. */
  onChanged?: (next: ProductStatus) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // Optimistic, so the chip changes colour on click instead of waiting for the next 5s poll.
  const [current, setCurrent] = useState<string>(status);

  async function pick(next: ProductStatus) {
    setOpen(false);
    if (next === current) return;
    const previous = current;
    setCurrent(next);
    setBusy(true);
    try {
      const res = await fetch(`/api/products/${productId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not update status");
      onChanged?.(next);
    } catch (err: any) {
      // Roll the chip back — leaving it showing a status the database never took would be worse
      // than the failed write itself.
      setCurrent(previous);
      toast.error(err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={busy}
        title="Change status"
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn(
          badgeVariants(),
          STATUS_COLORS[current] ?? STATUS_COLORS.New,
          "cursor-pointer hover:brightness-110"
        )}
      >
        {busy && <Loader2 className="h-3 w-3 animate-spin" />}
        {current}
        <ChevronDown className="h-3 w-3 opacity-70" />
      </button>

      {open && (
        <>
          {/* Click-away layer rather than a document listener — nothing to leak on unmount. */}
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div
            role="menu"
            className="absolute left-0 z-20 mt-1 w-36 overflow-hidden rounded-lg border border-ink-700 bg-ink-900 py-1 shadow-lg"
          >
            {PRODUCT_STATUSES.map((s) => (
              <button
                key={s}
                type="button"
                role="menuitem"
                onClick={() => pick(s)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-zinc-200 hover:bg-ink-800"
              >
                <span className={`h-2 w-2 shrink-0 rounded-full ${STATUS_COLORS[s]?.split(" ")[0]}`} />
                <span className="flex-1">{s}</span>
                {current === s && <Check className="h-3.5 w-3.5 text-emerald-400" />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
