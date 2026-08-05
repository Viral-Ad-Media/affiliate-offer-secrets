"use client";

import { useState } from "react";
import { Link2, Loader2, Check, X } from "lucide-react";
import { toast } from "@/lib/toast";

/**
 * Replace the affiliate link this app derives with one pasted from the network account.
 *
 * The derived link — buildHoplink(network, affiliateId, vendorId, tid) — is right almost always,
 * and wrong exactly where it hurts: a vendor on a non-standard hop domain, an offer promoted
 * through a sub-affiliate account, a network that hands out a pre-built tracking URL, or a vendor
 * id this app read wrong from the marketplace feed. When it's wrong, every ad, page and email in
 * the kit points somewhere that credits nobody, and nothing in the UI says so.
 */
export default function HoplinkOverride({
  productId,
  derived,
  initialOverride,
}: {
  productId: string;
  derived: string | null;
  initialOverride: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(initialOverride ?? "");
  const [saved, setSaved] = useState(initialOverride);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(next: string | null) {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/products/${productId}/hoplink`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hoplink_override: next ?? "" }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "Couldn't save");
      return;
    }
    setSaved(data.hoplink_override ?? null);
    setValue(data.hoplink_override ?? "");
    setOpen(false);
    // Re-rendering published pages is the half of this that isn't optional, so the confirmation
    // says whether it actually happened rather than just "saved".
    const n = data.rerendered ?? 0;
    toast.success(
      data.failed_campaigns
        ? `Saved, but ${data.failed_campaigns} funnel(s) still show the old link — try again`
        : next
          ? `Custom link saved${n ? ` — ${n} funnel page(s) updated` : ""}`
          : `Back to the generated link${n ? ` — ${n} funnel page(s) updated` : ""}`
    );
  }

  const effective = saved || derived;

  return (
    <div className="mt-3 rounded-lg border border-ink-700 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Link2 className="h-3.5 w-3.5 text-zinc-500" />
        <span className="text-xs font-medium text-zinc-400">Affiliate link</span>
        {saved ? (
          <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] text-amber-300">
            Custom
          </span>
        ) : (
          <span className="rounded-full bg-ink-700 px-2 py-0.5 text-[11px] text-zinc-400">
            Generated
          </span>
        )}
        {!open && (
          <button onClick={() => setOpen(true)} className="ml-auto text-xs text-emerald-300 hover:underline">
            {saved ? "Edit" : "Use my own link"}
          </button>
        )}
      </div>

      {!open && effective && (
        <p className="mt-1.5 break-all font-mono text-[11px] text-zinc-500">{effective}</p>
      )}

      {open && (
        <div className="mt-2 space-y-2">
          <input
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="https://… paste the link from your affiliate account"
            className="w-full rounded-lg border border-ink-600 bg-ink-900 px-3 py-2 font-mono text-xs outline-none focus:border-emerald-500"
          />
          <p className="text-[11px] text-zinc-500">
            Used exactly as pasted, everywhere — ads, pages, emails. Per-channel tracking tags
            (fb/tt/blog/email/page) are <strong>not</strong> added to a custom link, because there&apos;s
            no reliable way to know where your network expects them. Saving re-renders any published
            funnel page that uses this product.
          </p>
          {error && <p className="text-xs text-red-400">{error}</p>}
          <div className="flex items-center gap-2">
            <button
              onClick={() => save(value.trim() || null)}
              disabled={busy}
              className="btn-primary text-xs"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              Save
            </button>
            {saved && (
              <button onClick={() => save(null)} disabled={busy} className="btn-ghost text-xs">
                <X className="h-3.5 w-3.5" /> Use the generated link
              </button>
            )}
            <button
              onClick={() => {
                setOpen(false);
                setValue(saved ?? "");
                setError(null);
              }}
              className="text-xs text-zinc-500 hover:text-zinc-300"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
