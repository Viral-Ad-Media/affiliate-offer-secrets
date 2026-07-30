"use client";

import { useState } from "react";
import { Loader2, CheckCircle2, Lock } from "lucide-react";
import { DISCLOSURE, normalizePageCopy, firstImageDataUrl, type PageBlockTree } from "@/lib/engine/renderPages";
import WysiwygCanvas from "@/components/WysiwygCanvas";
import SeoFields, { type SeoValues } from "@/components/SeoFields";

const MAX_IMAGE_DATA_URL_CHARS = 280_000;

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
  initialCopy: unknown;
  initialBridgeHtml: string | null;
  onSaved: (result: { bridge_html: string; page_copy: PageBlockTree }) => void;
  // Defaults to the control's own save route. A split-test variant's editor (SplitTestPanel)
  // passes /api/bridge-variants/{id} instead — everything else about this component is identical.
  saveEndpoint?: string;
  // Opt-in page SEO lives on the campaign row; split-test variants share the campaign's values,
  // so the variant editor (SplitTestPanel) simply doesn't pass these.
  initialSeoTitle?: string | null;
  initialSeoDescription?: string | null;
  showSeo?: boolean;
};

export default function PageEditor({
  campaignId,
  productTitle,
  initialCopy,
  initialBridgeHtml,
  onSaved,
  saveEndpoint,
  initialSeoTitle,
  initialSeoDescription,
  showSeo = false,
}: Props) {
  const [tree, setTree] = useState<PageBlockTree>(() => normalizePageCopy(initialCopy, null));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [imageBusyBlockId, setImageBusyBlockId] = useState<string | null>(null);
  const [seo, setSeo] = useState<SeoValues>({
    seo_title: initialSeoTitle ?? "",
    seo_description: initialSeoDescription ?? "",
  });

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(saveEndpoint ?? `/api/campaigns/${campaignId}/page-copy`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          blocks: tree.blocks,
          image_data_url: firstImageDataUrl(tree),
          ...(showSeo ? seo : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save");
      onSaved({ bridge_html: data.bridge_html, page_copy: tree });
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
        reorder a block. The lead-capture form and disclosure are locked — they can't be edited
        or removed here.
      </p>

      {showSeo && (
        <SeoFields
          values={seo}
          onChange={setSeo}
          fallbackTitle={productTitle}
          noteWhenNoindex="Funnel pages are never indexed by search engines — these control how the page looks when the URL is shared."
        />
      )}

      <WysiwygCanvas
        tree={tree}
        onChange={setTree}
        resizeImageFile={resizeImageFile}
        imageBusyBlockId={imageBusyBlockId}
        onImageBusyChange={setImageBusyBlockId}
        onImageError={setError}
        productTitle={productTitle}
      />

      <p className="mx-auto flex max-w-[680px] items-center gap-1.5 text-xs text-zinc-500">
        <Lock className="h-3 w-3 shrink-0" /> {DISCLOSURE}
      </p>

      {error && <p className="text-sm text-red-300">{error}</p>}

      <div className="flex items-center gap-3">
        <button onClick={save} disabled={saving || !!imageBusyBlockId} className="btn-primary">
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
