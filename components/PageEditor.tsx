"use client";

import { useMemo, useRef, useState } from "react";
import { Plus, Trash2, Image as ImageIcon, Loader2, CheckCircle2 } from "lucide-react";
import { renderPresellHtml, renderBridgeHtml, type PageCopy } from "@/lib/engine/renderPages";

const MAX_IMAGE_DATA_URL_CHARS = 280_000;

function extractImageSrc(html: string | null): string | null {
  if (!html) return null;
  const match = html.match(/<img src="([^"]*)"/);
  return match ? match[1] : null;
}

// Downscale/re-encode client-side so most real photos land under the server's size cap without
// the user having to think about it — the server's own validation (route.ts) is the actual
// boundary, this is just UX.
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

type Props = {
  campaignId: string;
  productTitle: string;
  initialCopy: PageCopy | null;
  initialPresellHtml: string | null;
  initialBridgeHtml: string | null;
  previewHoplink: string;
  onSaved: (result: { presell_html: string; bridge_html: string; page_copy: PageCopy }) => void;
};

const emptyCopy: PageCopy = {
  headline: "",
  lead: "",
  mechanism: "",
  benefits: [""],
  proof: "",
  faq: [{ q: "", a: "" }],
  cta: "Get started",
  landing_md: "",
};

export default function PageEditor({
  campaignId,
  productTitle,
  initialCopy,
  initialPresellHtml,
  initialBridgeHtml,
  previewHoplink,
  onSaved,
}: Props) {
  const [copy, setCopy] = useState<PageCopy>(initialCopy ?? emptyCopy);
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(
    extractImageSrc(initialPresellHtml ?? initialBridgeHtml)
  );
  const [previewTab, setPreviewTab] = useState<"presell" | "bridge">("presell");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [imageBusy, setImageBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const product = useMemo(() => ({ product_title: productTitle }), [productTitle]);

  const previewHtml =
    previewTab === "presell"
      ? renderPresellHtml(product, copy, previewHoplink, imageDataUrl)
      : renderBridgeHtml(product, copy, previewHoplink, imageDataUrl);

  function update<K extends keyof PageCopy>(key: K, value: PageCopy[K]) {
    setCopy((c) => ({ ...c, [key]: value }));
  }

  function updateBenefit(i: number, value: string) {
    const next = [...copy.benefits];
    next[i] = value;
    update("benefits", next);
  }

  function updateFaq(i: number, field: "q" | "a", value: string) {
    const next = copy.faq.map((f, idx) => (idx === i ? { ...f, [field]: value } : f));
    update("faq", next);
  }

  async function handleImagePick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
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
      const res = await fetch(`/api/campaigns/${campaignId}/page-copy`, {
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
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save");
      onSaved({ presell_html: data.presell_html, bridge_html: data.bridge_html, page_copy: copy });
      setSavedAt(Date.now());
    } catch (err: any) {
      setError(err?.message ?? "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  if (!initialCopy) {
    return (
      <p className="rounded-lg bg-ink-800 p-4 text-sm text-zinc-400">
        This campaign was generated before the no-code editor existed, so there's no structured
        copy to edit yet. Regenerate the campaign kit to enable editing.
      </p>
    );
  }

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="space-y-4">
        <div>
          <label className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Headline
          </label>
          <input
            value={copy.headline}
            onChange={(e) => update("headline", e.target.value)}
            maxLength={200}
            className="mt-1 w-full rounded-lg border border-ink-600 bg-ink-800 px-3 py-2 text-sm text-zinc-100"
          />
        </div>

        <div>
          <label className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Lead paragraph
          </label>
          <textarea
            value={copy.lead}
            onChange={(e) => update("lead", e.target.value)}
            maxLength={1000}
            rows={3}
            className="mt-1 w-full rounded-lg border border-ink-600 bg-ink-800 px-3 py-2 text-sm text-zinc-100"
          />
        </div>

        <div>
          <label className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
            How it works
          </label>
          <textarea
            value={copy.mechanism}
            onChange={(e) => update("mechanism", e.target.value)}
            maxLength={3000}
            rows={3}
            className="mt-1 w-full rounded-lg border border-ink-600 bg-ink-800 px-3 py-2 text-sm text-zinc-100"
          />
        </div>

        <div>
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Benefits
            </label>
            <button
              type="button"
              onClick={() => update("benefits", [...copy.benefits, ""])}
              disabled={copy.benefits.length >= 10}
              className="btn-ghost !py-1 text-xs"
            >
              <Plus className="h-3.5 w-3.5" /> Add
            </button>
          </div>
          <div className="mt-1 space-y-2">
            {copy.benefits.map((b, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  value={b}
                  onChange={(e) => updateBenefit(i, e.target.value)}
                  maxLength={300}
                  className="flex-1 rounded-lg border border-ink-600 bg-ink-800 px-3 py-2 text-sm text-zinc-100"
                />
                <button
                  type="button"
                  onClick={() => update("benefits", copy.benefits.filter((_, idx) => idx !== i))}
                  className="rounded-lg p-2 text-zinc-500 hover:bg-ink-800 hover:text-red-300"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </div>

        <div>
          <label className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Proof / credibility
          </label>
          <textarea
            value={copy.proof}
            onChange={(e) => update("proof", e.target.value)}
            maxLength={1000}
            rows={2}
            className="mt-1 w-full rounded-lg border border-ink-600 bg-ink-800 px-3 py-2 text-sm text-zinc-100"
          />
        </div>

        <div>
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              FAQ
            </label>
            <button
              type="button"
              onClick={() => update("faq", [...copy.faq, { q: "", a: "" }])}
              disabled={copy.faq.length >= 10}
              className="btn-ghost !py-1 text-xs"
            >
              <Plus className="h-3.5 w-3.5" /> Add
            </button>
          </div>
          <div className="mt-1 space-y-3">
            {copy.faq.map((f, i) => (
              <div key={i} className="rounded-lg border border-ink-700 p-2.5">
                <div className="flex items-center gap-2">
                  <input
                    value={f.q}
                    onChange={(e) => updateFaq(i, "q", e.target.value)}
                    placeholder="Question"
                    maxLength={200}
                    className="flex-1 rounded-lg border border-ink-600 bg-ink-800 px-3 py-1.5 text-sm text-zinc-100"
                  />
                  <button
                    type="button"
                    onClick={() => update("faq", copy.faq.filter((_, idx) => idx !== i))}
                    className="rounded-lg p-2 text-zinc-500 hover:bg-ink-800 hover:text-red-300"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                <textarea
                  value={f.a}
                  onChange={(e) => updateFaq(i, "a", e.target.value)}
                  placeholder="Answer"
                  maxLength={1000}
                  rows={2}
                  className="mt-1.5 w-full rounded-lg border border-ink-600 bg-ink-800 px-3 py-1.5 text-sm text-zinc-100"
                />
              </div>
            ))}
          </div>
        </div>

        <div>
          <label className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
            CTA button text
          </label>
          <input
            value={copy.cta}
            onChange={(e) => update("cta", e.target.value)}
            maxLength={60}
            className="mt-1 w-full rounded-lg border border-ink-600 bg-ink-800 px-3 py-2 text-sm text-zinc-100"
          />
        </div>

        <div>
          <label className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Image
          </label>
          <div className="mt-1 flex items-center gap-2">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={imageBusy}
              className="btn-ghost !py-1.5 text-xs"
            >
              {imageBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImageIcon className="h-3.5 w-3.5" />}
              {imageDataUrl ? "Replace image" : "Upload image"}
            </button>
            {imageDataUrl && (
              <button
                type="button"
                onClick={() => setImageDataUrl(null)}
                className="text-xs text-zinc-500 hover:text-red-300"
              >
                Remove
              </button>
            )}
            <input ref={fileRef} type="file" accept="image/*" onChange={handleImagePick} className="hidden" />
          </div>
          {imageDataUrl && (
            <img src={imageDataUrl} alt="" className="mt-2 h-20 rounded-lg border border-ink-700 object-cover" />
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

      <div>
        <div className="mb-2 flex gap-1 text-xs">
          <button
            onClick={() => setPreviewTab("presell")}
            className={`rounded-full px-2.5 py-1 ${previewTab === "presell" ? "bg-emerald-600 text-white" : "text-zinc-400 hover:bg-ink-700"}`}
          >
            Presell preview
          </button>
          <button
            onClick={() => setPreviewTab("bridge")}
            className={`rounded-full px-2.5 py-1 ${previewTab === "bridge" ? "bg-emerald-600 text-white" : "text-zinc-400 hover:bg-ink-700"}`}
          >
            Bridge preview
          </button>
        </div>
        <iframe
          srcDoc={previewHtml}
          sandbox={previewTab === "bridge" ? "allow-scripts" : ""}
          title="Live preview"
          className="h-[70vh] w-full rounded-lg border border-ink-700 bg-white"
        />
      </div>
    </div>
  );
}
