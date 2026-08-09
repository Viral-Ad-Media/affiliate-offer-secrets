"use client";

import { useState } from "react";
import { BarChart3, Loader2, CheckCircle2 } from "lucide-react";
import { Label } from "@/components/ui/label";
import type { TrackingSettings } from "@/lib/engine/renderPages";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

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
  bare = false,
  onSaved,
}: {
  campaignId: string;
  initialTracking: TrackingSettings | null;
  /**
   * Drop the Card chrome. Set when this renders inside the funnel settings dialog, which already
   * provides the surface — a card inside a dialog is a border inside a border. The heading stays
   * either way: in the dialog it is what separates this section from the next one.
   */
  bare?: boolean;
  /**
   * Tell the parent the row changed. Load-bearing inside the settings dialog: Radix unmounts
   * dialog content on close, so this component remounts from `initialTracking` every time it
   * opens — without a refresh the second open would show the value from before the last save.
   */
  onSaved?: () => void;
}) {
  const [fields, setFields] = useState<Record<string, string>>({
    ga4_id: initialTracking?.ga4_id ?? "",
    gtm_id: initialTracking?.gtm_id ?? "",
    clarity_id: initialTracking?.clarity_id ?? "",
    meta_pixel_id: initialTracking?.meta_pixel_id ?? "",
  });
  const [consent, setConsent] = useState({
    enabled: initialTracking?.consent_enabled === true,
    text: initialTracking?.consent_text ?? "",
    accept: initialTracking?.consent_accept ?? "",
    decline: initialTracking?.consent_decline ?? "",
    policy: initialTracking?.consent_policy_url ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const hasTags = Object.values(fields).some((v) => v.trim() !== "");

  async function save() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/campaigns/${campaignId}/tracking`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...fields,
        consent_enabled: consent.enabled,
        consent_text: consent.text,
        consent_accept: consent.accept,
        consent_decline: consent.decline,
        consent_policy_url: consent.policy,
      }),
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
    onSaved?.();
  }

  // A plain conditional around a shared element tree, NOT a component defined in this body — a
  // wrapper component declared inside the render gets a new identity every render, which unmounts
  // and remounts everything under it, and everything under it here is a controlled input someone
  // is typing into. Same trap WysiwygCanvas documents for its own wrappers.
  const body = (
    <>
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
        <div className="mb-4 space-y-3 rounded-lg border border-ink-700 bg-ink-800/40 p-3">
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={consent.enabled}
              onChange={(e) => setConsent((c) => ({ ...c, enabled: e.target.checked }))}
              className="mt-0.5"
            />
            <span>
              <span className="block text-sm font-medium text-zinc-100">Ask for cookie consent</span>
              <span className="mt-0.5 block text-[11px] leading-snug text-zinc-500">
                Nothing above runs until the visitor accepts — the tags sit inert until then, and
                Decline loads none of them. This is the part that makes a banner mean something:
                a prompt shown over an already-fired pixel isn&apos;t consent.
              </span>
            </span>
          </label>

          {consent.enabled && !hasTags && (
            <p className="text-[11px] text-amber-300">
              No tracking IDs above yet, so no banner will show — there&apos;d be nothing to ask about.
            </p>
          )}

          {consent.enabled && (
            <div className="space-y-2">
              <input
                value={consent.text}
                onChange={(e) => setConsent((c) => ({ ...c, text: e.target.value }))}
                maxLength={400}
                placeholder="We use cookies to measure how this page performs. You choose whether we do."
                className="w-full rounded-lg border border-ink-600 bg-ink-900 px-2.5 py-1.5 text-xs outline-none focus:border-emerald-500"
              />
              <div className="flex gap-2">
                <input
                  value={consent.accept}
                  onChange={(e) => setConsent((c) => ({ ...c, accept: e.target.value }))}
                  maxLength={40}
                  placeholder="Accept"
                  className="w-1/2 rounded-lg border border-ink-600 bg-ink-900 px-2.5 py-1.5 text-xs outline-none focus:border-emerald-500"
                />
                <input
                  value={consent.decline}
                  onChange={(e) => setConsent((c) => ({ ...c, decline: e.target.value }))}
                  maxLength={40}
                  placeholder="Decline"
                  className="w-1/2 rounded-lg border border-ink-600 bg-ink-900 px-2.5 py-1.5 text-xs outline-none focus:border-emerald-500"
                />
              </div>
              <input
                value={consent.policy}
                onChange={(e) => setConsent((c) => ({ ...c, policy: e.target.value }))}
                maxLength={2000}
                placeholder="https://… link to your privacy policy (optional)"
                className="w-full rounded-lg border border-ink-600 bg-ink-900 px-2.5 py-1.5 text-xs outline-none focus:border-emerald-500"
              />
            </div>
          )}
        </div>

        <Button onClick={save} disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Save tracking
        </Button>
        {savedAt && Date.now() - savedAt < 4000 && (
          <span className="flex items-center gap-1 text-xs text-emerald-300">
            <CheckCircle2 className="h-3.5 w-3.5" /> Saved — all pages re-published
          </span>
        )}
      </div>
    </>
  );

  return bare ? (
    <section>{body}</section>
  ) : (
    <Card as="section" className="p-4">
      {body}
    </Card>
  );
}
