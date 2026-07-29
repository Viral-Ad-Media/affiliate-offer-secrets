"use client";

import { useState } from "react";
import { Loader2, CheckCircle2, Lock } from "lucide-react";
import { DISCLOSURE, type PageCopy, type FunnelStepType } from "@/lib/engine/renderPages";
import type { FunnelStepCtaAction } from "@/lib/shared";
import WysiwygCanvas from "@/components/WysiwygCanvas";

const MAX_IMAGE_DATA_URL_CHARS = 280_000;

function extractImageSrc(html: string | null): string | null {
  if (!html) return null;
  const match = html.match(/<img src="([^"]*)"/);
  return match ? match[1] : null;
}

// Same client-side downscale as PageEditor.tsx's resizeImageFile — the server's own validation
// (app/api/funnel-steps/[id]/route.ts) is the actual boundary, this is just UX.
async function resizeImageFile(file: File): Promise<string> {
  const dataUrl: string = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("Could not read image"));
    img.src = dataUrl;
  });

  let maxDim = 1000;
  let quality = 0.82;
  for (let attempt = 0; attempt < 4; attempt++) {
    const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return dataUrl;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const resized = canvas.toDataURL("image/jpeg", quality);
    if (resized.length <= MAX_IMAGE_DATA_URL_CHARS) return resized;
    maxDim = Math.round(maxDim * 0.75);
    quality = Math.max(0.5, quality - 0.15);
  }
  throw new Error("Image is too large even after compression — try a smaller file.");
}

const emptyCopy: PageCopy = {
  headline: "",
  lead: "",
  mechanism: "",
  benefits: [""],
  proof: "",
  faq: [{ q: "", a: "" }],
  cta: "Continue",
};

type Props = {
  stepId: string;
  stepType: FunnelStepType;
  productTitle: string;
  initialCopy: PageCopy | null;
  initialHtml: string | null;
  initialCtaAction: FunnelStepCtaAction;
  initialRedirectUrl: string | null;
  initialTargetProductId: string | null;
  initialDeclineAction: FunnelStepCtaAction;
  initialDeclineRedirectUrl: string | null;
  crossSellOptions: { id: string; title: string }[];
  onSaved: (result: { html: string; page_copy: PageCopy }) => void;
};

export default function FunnelStepEditor({
  stepId,
  stepType,
  productTitle,
  initialCopy,
  initialHtml,
  initialCtaAction,
  initialRedirectUrl,
  initialTargetProductId,
  initialDeclineAction,
  initialDeclineRedirectUrl,
  crossSellOptions,
  onSaved,
}: Props) {
  const [copy, setCopy] = useState<PageCopy>(initialCopy ?? emptyCopy);
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(extractImageSrc(initialHtml));
  const [ctaAction, setCtaAction] = useState<FunnelStepCtaAction>(initialCtaAction);
  const [redirectUrl, setRedirectUrl] = useState(initialRedirectUrl ?? "");
  const [targetProductId, setTargetProductId] = useState<string>(initialTargetProductId ?? "");
  const [declineAction, setDeclineAction] = useState<FunnelStepCtaAction>(initialDeclineAction);
  const [declineRedirectUrl, setDeclineRedirectUrl] = useState(initialDeclineRedirectUrl ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [imageBusy, setImageBusy] = useState(false);

  function update<K extends keyof PageCopy>(key: K, value: PageCopy[K]) {
    setCopy((c) => ({ ...c, [key]: value }));
  }

  async function handleImageFile(file: File) {
    setImageBusy(true);
    setError(null);
    try {
      const resized = await resizeImageFile(file);
      setImageDataUrl(resized);
    } catch (err: any) {
      setError(err?.message ?? "Could not process image");
    } finally {
      setImageBusy(false);
    }
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/funnel-steps/${stepId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          headline: copy.headline,
          lead: copy.lead,
          mechanism: copy.mechanism,
          benefits: copy.benefits.filter((b) => b.trim()),
          proof: copy.proof,
          faq: copy.faq.filter((f) => f.q.trim() && f.a.trim()),
          cta: copy.cta,
          image_data_url: imageDataUrl,
          cta_action: ctaAction,
          redirect_url: ctaAction === "redirect_url" ? redirectUrl : null,
          target_product_id: targetProductId || null,
          decline_action: declineAction,
          decline_redirect_url: declineAction === "redirect_url" ? declineRedirectUrl : null,
          section_order: copy.sectionOrder,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save");
      onSaved({ html: data.html, page_copy: copy });
      setSavedAt(Date.now());
    } catch (err: any) {
      setError(err?.message ?? "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-zinc-500">
        Click any text below to edit it in place, drag <span className="text-zinc-400">⠿</span> to
        reorder a section.
      </p>

      <WysiwygCanvas
        copy={copy}
        onChange={update}
        imageDataUrl={imageDataUrl}
        onImageFile={handleImageFile}
        onImageRemove={() => setImageDataUrl(null)}
        imageBusy={imageBusy}
        productTitle={productTitle}
        belowCta={
          stepType === "upsell" ? (
            <p className="mt-3 text-center text-[13px] text-gray-500 underline">No thanks, continue</p>
          ) : null
        }
      />

      <p className="mx-auto flex max-w-[680px] items-center gap-1.5 text-xs text-zinc-500">
        <Lock className="h-3 w-3 shrink-0" /> {DISCLOSURE}
      </p>

      <div className="space-y-3 rounded-lg border border-ink-700 p-3">
        {stepType === "upsell" ? (
          <>
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                When Accept is clicked
              </label>
              <select
                value={ctaAction}
                onChange={(e) => setCtaAction(e.target.value as FunnelStepCtaAction)}
                className="mt-1 w-full rounded-lg border border-ink-600 bg-ink-800 px-3 py-2 text-sm text-zinc-100"
              >
                <option value="hoplink">Go to a product's hoplink</option>
                <option value="next_step">Continue to the next step (or the hoplink, if last)</option>
                <option value="redirect_url">Redirect to a custom URL</option>
              </select>
              {ctaAction === "hoplink" && (
                <select
                  value={targetProductId}
                  onChange={(e) => setTargetProductId(e.target.value)}
                  className="mt-2 w-full rounded-lg border border-ink-600 bg-ink-800 px-3 py-2 text-sm text-zinc-100"
                >
                  <option value="">This funnel's own product</option>
                  {crossSellOptions.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title}
                    </option>
                  ))}
                </select>
              )}
              {ctaAction === "redirect_url" && (
                <input
                  value={redirectUrl}
                  onChange={(e) => setRedirectUrl(e.target.value)}
                  placeholder="https://example.com/checkout"
                  maxLength={2000}
                  className="mt-2 w-full rounded-lg border border-ink-600 bg-ink-800 px-3 py-2 text-sm text-zinc-100"
                />
              )}
            </div>

            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                When "No thanks, continue" is clicked
              </label>
              <select
                value={declineAction}
                onChange={(e) => setDeclineAction(e.target.value as FunnelStepCtaAction)}
                className="mt-1 w-full rounded-lg border border-ink-600 bg-ink-800 px-3 py-2 text-sm text-zinc-100"
              >
                <option value="next_step">Continue to the next step (or the original hoplink, if last)</option>
                <option value="hoplink">Go straight to the original product's hoplink</option>
                <option value="redirect_url">Redirect to a custom URL</option>
              </select>
              {declineAction === "redirect_url" && (
                <input
                  value={declineRedirectUrl}
                  onChange={(e) => setDeclineRedirectUrl(e.target.value)}
                  placeholder="https://example.com/no-thanks"
                  maxLength={2000}
                  className="mt-2 w-full rounded-lg border border-ink-600 bg-ink-800 px-3 py-2 text-sm text-zinc-100"
                />
              )}
            </div>
          </>
        ) : (
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              When clicked, this CTA should
            </label>
            <select
              value={ctaAction}
              onChange={(e) => setCtaAction(e.target.value as FunnelStepCtaAction)}
              className="mt-1 w-full rounded-lg border border-ink-600 bg-ink-800 px-3 py-2 text-sm text-zinc-100"
            >
              <option value="next_step">Continue to the next step (or the hoplink, if last)</option>
              <option value="hoplink">Go straight to the hoplink</option>
              <option value="redirect_url">Redirect to a custom URL</option>
            </select>
            {ctaAction === "redirect_url" && (
              <input
                value={redirectUrl}
                onChange={(e) => setRedirectUrl(e.target.value)}
                placeholder="https://example.com/thank-you"
                maxLength={2000}
                className="mt-2 w-full rounded-lg border border-ink-600 bg-ink-800 px-3 py-2 text-sm text-zinc-100"
              />
            )}
          </div>
        )}
      </div>

      {error && <p className="text-sm text-red-300">{error}</p>}

      <div className="flex items-center gap-3">
        <button onClick={save} disabled={saving || imageBusy} className="btn-primary">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Save &amp; Republish
        </button>
        {savedAt && Date.now() - savedAt < 4000 && (
          <span className="flex items-center gap-1 text-xs text-emerald-300">
            <CheckCircle2 className="h-3.5 w-3.5" /> Saved
          </span>
        )}
      </div>
    </div>
  );
}
