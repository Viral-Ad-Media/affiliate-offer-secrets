"use client";

import { useState } from "react";
import { Loader2, CheckCircle2, Lock } from "lucide-react";
import { DISCLOSURE, LEAD_CONSENT_TEXT, type PageCopy } from "@/lib/engine/renderPages";
import WysiwygCanvas from "@/components/WysiwygCanvas";

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
  initialBridgeHtml: string | null;
  onSaved: (result: { bridge_html: string; page_copy: PageCopy }) => void;
  // Defaults to the control's own save route. A split-test variant's editor (SplitTestPanel)
  // passes /api/bridge-variants/{id} instead — everything else about this component is identical.
  saveEndpoint?: string;
};

const emptyCopy: PageCopy = {
  headline: "",
  lead: "",
  mechanism: "",
  benefits: [""],
  proof: "",
  faq: [{ q: "", a: "" }],
  cta: "Get started",
};

export default function PageEditor({
  campaignId,
  productTitle,
  initialCopy,
  initialBridgeHtml,
  onSaved,
  saveEndpoint,
}: Props) {
  const [copy, setCopy] = useState<PageCopy>(initialCopy ?? emptyCopy);
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(extractImageSrc(initialBridgeHtml));
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
      const res = await fetch(saveEndpoint ?? `/api/campaigns/${campaignId}/page-copy`, {
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
          section_order: copy.sectionOrder,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save");
      onSaved({ bridge_html: data.bridge_html, page_copy: copy });
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
    <div className="space-y-4">
      <p className="text-xs text-zinc-500">
        Click any text below to edit it in place, drag <span className="text-zinc-400">⠿</span> to
        reorder a section. The lead-capture form and disclosure are locked — they can't be edited
        or removed here.
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
          <div className="mx-auto mt-6 max-w-[420px] rounded-xl border border-[#e5e5e5] bg-white p-6 text-center">
            <input disabled placeholder="First name" className="mb-2 w-full rounded-lg border border-gray-300 bg-gray-50 px-3.5 py-3 text-[15px] text-gray-400" />
            <input disabled placeholder="Email address" className="mb-2 w-full rounded-lg border border-gray-300 bg-gray-50 px-3.5 py-3 text-[15px] text-gray-400" />
            <div className="mt-2 rounded-lg bg-[#16a34a]/40 px-8 py-3.5 text-[15px] font-semibold text-white">
              {copy.cta || "Get started"}
            </div>
            <p className="mt-3 flex items-center justify-center gap-1 text-left text-[11px] text-gray-500">
              <Lock className="h-3 w-3 shrink-0" /> {LEAD_CONSENT_TEXT}
            </p>
          </div>
        }
      />

      <p className="mx-auto flex max-w-[680px] items-center gap-1.5 text-xs text-zinc-500">
        <Lock className="h-3 w-3 shrink-0" /> {DISCLOSURE}
      </p>

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
