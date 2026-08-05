"use client";

import { useState } from "react";
import { CheckCircle2, ExternalLink, Link2, Loader2 } from "lucide-react";
import { toast } from "@/lib/toast";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * Where a standalone funnel's call to action sends people.
 *
 * Only rendered for a funnel with no product. With one, the affiliate hoplink is the destination
 * and this would be a second control claiming to set the same thing.
 *
 * Saving re-renders the whole funnel server-side, because hrefs are baked into stored HTML at
 * write time — the note below says so, since "saved" and "live" being different things is exactly
 * the kind of surprise worth spending a sentence on.
 */
export default function OfferLinkPanel({
  campaignId,
  initialUrl,
  onSaved,
}: {
  campaignId: string;
  initialUrl: string | null;
  onSaved?: () => void;
}) {
  const [url, setUrl] = useState(initialUrl ?? "");
  const [busy, setBusy] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  async function save() {
    setBusy(true);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/cta-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cta_url: url }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json.error ?? "Could not save");
        return;
      }
      setUrl(json.cta_url ?? "");
      setSavedAt(Date.now());
      toast.success(json.cta_url ? "Destination saved" : "Destination cleared");
      onSaved?.();
    } catch {
      toast.error("Could not save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card as="section" className="space-y-3 p-4">
      <div>
        <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
          <Link2 className="h-4 w-4 text-emerald-400" /> Where the button goes
        </h2>
        <p className="mt-0.5 text-xs text-zinc-500">
          This funnel isn&apos;t attached to an offer, so there&apos;s no affiliate link to send
          people to. Paste the destination — a vendor&apos;s sales page, a booking link, anywhere.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com/offer"
          className="min-w-0 flex-1 rounded-lg border border-ink-600 bg-ink-900 px-3 py-2 text-sm outline-none focus:border-emerald-500"
        />
        <Button onClick={save} disabled={busy} className="text-sm">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save
        </Button>
        {url && (
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            title="Open in a new tab"
            className={cn(buttonVariants({ variant: "outline" }), "!px-2")}
          >
            <ExternalLink className="h-4 w-4" />
          </a>
        )}
        {savedAt && Date.now() - savedAt < 4000 && (
          <span className="flex items-center gap-1 text-xs text-emerald-300">
            <CheckCircle2 className="h-3.5 w-3.5" /> Saved
          </span>
        )}
      </div>

      {!url && (
        <p className="text-xs text-amber-300">
          No destination set — the button is a dead link until you add one.
        </p>
      )}
      <p className="text-[11px] text-zinc-600">
        Saving re-renders every page in this funnel, since links are baked into the published HTML
        rather than looked up when someone visits.
      </p>
    </Card>
  );
}
