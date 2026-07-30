"use client";

import { useState } from "react";
import { BarChart3, Loader2, CheckCircle2 } from "lucide-react";
import { Label } from "@/components/ui/label";
import type { TrackingSettings } from "@/lib/engine/renderPages";

const FIELDS: { key: keyof TrackingSettings; label: string; placeholder: string }[] = [
  { key: "ga4_id", label: "Google Analytics (GA4)", placeholder: "G-XXXXXXXXXX — or paste the full gtag.js snippet" },
  { key: "gtm_id", label: "Google Tag Manager", placeholder: "GTM-XXXXXXX — or paste the full container snippet" },
  { key: "clarity_id", label: "Microsoft Clarity", placeholder: "Project ID — or paste the full Clarity snippet" },
  { key: "meta_pixel_id", label: "Meta Pixel", placeholder: "Pixel ID — or paste the full base code" },
];

// Funnel-level analytics settings, shown on the funnel map view. Each field takes the bare ID OR
// the full "paste before </head>" install snippet the platform hands out — the server extracts
// the ID and installs its own code-owned version of the snippet (the pasted markup itself is
// never stored or rendered; see lib/engine/tracking.ts for why raw script injection on the
// shared /p/ origin is off the table). Saving re-renders every page this funnel serves (opt-in,
// variants, steps). The Meta Pixel additionally fires a Lead event on opt-in form submit.
export default function TrackingPanel({
  campaignId,
  initialTracking,
}: {
  campaignId: string;
  initialTracking: TrackingSettings | null;
}) {
  const [fields, setFields] = useState<Record<string, string>>({
    ga4_id: initialTracking?.ga4_id ?? "",
    gtm_id: initialTracking?.gtm_id ?? "",
    clarity_id: initialTracking?.clarity_id ?? "",
    meta_pixel_id: initialTracking?.meta_pixel_id ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/campaigns/${campaignId}/tracking`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fields),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "Failed to save");
      return;
    }
    // Collapse pasted snippets down to the clean extracted IDs the server actually stored.
    setFields({
      ga4_id: data.tracking?.ga4_id ?? "",
      gtm_id: data.tracking?.gtm_id ?? "",
      clarity_id: data.tracking?.clarity_id ?? "",
      meta_pixel_id: data.tracking?.meta_pixel_id ?? "",
    });
    setSavedAt(Date.now());
  }

  return (
    <section className="card p-4">
      <div className="mb-1 flex items-center gap-2 text-sm font-semibold text-zinc-100">
        <BarChart3 className="h-4 w-4 text-emerald-400" /> Tracking
      </div>
      <p className="mb-3 text-xs text-zinc-500">
        Paste the ID or the full install code each platform gives you — the ID is extracted and
        installed on every page of this funnel (opt-in, variants, and steps). The Meta Pixel also
        fires a Lead event when a visitor submits the opt-in form. Leave a field empty to remove
        that integration.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        {FIELDS.map(({ key, label, placeholder }) => (
          <div key={key} className="space-y-1.5">
            <Label htmlFor={`tracking_${key}`}>{label}</Label>
            <textarea
              id={`tracking_${key}`}
              rows={2}
              value={fields[key]}
              onChange={(e) => setFields((f) => ({ ...f, [key]: e.target.value }))}
              placeholder={placeholder}
              className="flex w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs shadow-sm placeholder:font-sans placeholder:text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>
        ))}
      </div>

      {error && <p className="mt-2 text-sm text-red-300">{error}</p>}

      <div className="mt-3 flex items-center gap-3">
        <button onClick={save} disabled={busy} className="btn-primary">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Save tracking
        </button>
        {savedAt && Date.now() - savedAt < 4000 && (
          <span className="flex items-center gap-1 text-xs text-emerald-300">
            <CheckCircle2 className="h-3.5 w-3.5" /> Saved — all pages re-published
          </span>
        )}
      </div>
    </section>
  );
}
