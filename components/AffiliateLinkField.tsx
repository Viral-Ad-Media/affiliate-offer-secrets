"use client";

import { useState } from "react";
import { Link2, Loader2, Check, X, TriangleAlert, ExternalLink } from "lucide-react";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { networkInfo } from "@/lib/networks";
import { cn } from "@/lib/utils";

/**
 * The product's affiliate link — pasted, never derived.
 *
 * This was `HoplinkOverride`: an optional customization sitting beside a link the app built from
 * (network, affiliateId, vendorId). Nothing builds one now (see affiliateLink() in renderPages.ts),
 * so this is no longer an override of anything — it is the only source, and the empty state has to
 * read as unfinished work rather than an offer to customize. A "Generated" chip over a link nobody
 * verified was the more dangerous version of this component.
 *
 * The wording at the point of entry states the one real cost of the change: a pasted link is used
 * verbatim for every channel, so no per-channel tracking token is added. Saying it here is the
 * whole reason it is defensible — the alternative was appending a guess.
 */
export default function AffiliateLinkField({
  productId,
  network,
  initialLink,
  hasKit,
}: {
  productId: string;
  network: string | null;
  initialLink: string | null;
  /** A built kit with no link is the state worth shouting about — pages exist and lead nowhere. */
  hasKit?: boolean;
}) {
  const info = network ? networkInfo(network) : null;
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(initialLink ?? "");
  const [saved, setSaved] = useState(initialLink);
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

    // Saving is only half the job — the link is baked into stored HTML — so the confirmation says
    // what actually got rewritten rather than a bare "saved".
    if (data.failed_campaigns) {
      toast.error(`Saved, but ${data.failed_campaigns} funnel(s) still show the old link — try again`);
      return;
    }
    if (!next) {
      toast.success("Affiliate link removed — pages now have no offer link");
      return;
    }
    const bits = [
      data.rerendered ? `${data.rerendered} funnel page(s)` : null,
      data.blog_updated ? `${data.blog_updated} article(s)` : null,
    ].filter(Boolean);
    toast.success(bits.length ? `Link saved — updated ${bits.join(" and ")}` : "Affiliate link saved");
  }

  const missing = !saved;
  const urgent = missing && hasKit;

  return (
    <div
      className={cn(
        "mt-3 rounded-lg border p-3",
        urgent ? "border-amber-500/40 bg-amber-500/5" : "border-ink-700"
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        {urgent ? (
          <TriangleAlert className="h-3.5 w-3.5 text-amber-300" />
        ) : (
          <Link2 className="h-3.5 w-3.5 text-zinc-500" />
        )}
        <span className="text-xs font-medium text-zinc-300">Affiliate link</span>
        {missing ? (
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[11px]",
              urgent ? "bg-amber-500/15 text-amber-300" : "bg-ink-700 text-zinc-400"
            )}
          >
            Not set
          </span>
        ) : (
          <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] text-emerald-300">
            Set
          </span>
        )}
        {!open && (
          <button
            onClick={() => setOpen(true)}
            className="ml-auto text-xs text-emerald-300 hover:underline"
          >
            {saved ? "Edit" : "Add your link"}
          </button>
        )}
      </div>

      {!open && saved && <p className="mt-1.5 break-all font-mono text-[11px] text-zinc-500">{saved}</p>}

      {!open && missing && (
        <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-400">
          {urgent
            ? "This kit is built but has nowhere to send traffic. "
            : "This app doesn't build affiliate links — a link it guessed could resolve, look tracked and credit nobody. "}
          Copy the real link out of{info ? ` your ${info.label} account` : " your affiliate account"} and
          paste it here.
        </p>
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
          {info && <p className="text-[11px] text-zinc-500">{info.help}</p>}
          <p className="text-[11px] leading-relaxed text-zinc-500">
            Used <strong>exactly as pasted</strong>, everywhere — ads, funnel pages, emails, blog
            articles. Per-channel tracking tags aren&apos;t added, because there&apos;s no reliable place
            to put one in an arbitrary link; paste a link that already carries your own tracking token
            if you want the breakdown. Saving re-renders every published page that uses this product.
          </p>
          {error && <p className="text-xs text-red-400">{error}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => save(value.trim() || null)} disabled={busy} className="text-xs">
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Check className="h-3.5 w-3.5" />
              )}
              Save
            </Button>
            {saved && (
              <Button onClick={() => save(null)} disabled={busy} variant="outline" className="text-xs">
                <X className="h-3.5 w-3.5" /> Remove
              </Button>
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

      {!open && missing && info && (
        <p className="mt-1.5 flex items-center gap-1 text-[11px] text-zinc-500">
          <ExternalLink className="h-3 w-3" /> {info.help}
        </p>
      )}
    </div>
  );
}
