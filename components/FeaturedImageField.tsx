"use client";

import { useEffect, useRef, useState } from "react";
import { useCredits } from "@/components/CreditsProvider";
import CostBadge from "@/components/CostBadge";
import { ImagePlus, Loader2, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

// Featured image control for the post editor: upload your own, or generate one from the post's
// title/content via the kie.ai pipeline (generate_blog_image job). Polls while a generation is
// running, the same shape as CreativeItemCard/GenerateVideo.
export default function FeaturedImageField({
  postId,
  value,
  status,
  error,
  onChange,
}: {
  postId: string;
  value: string | null;
  status: string;
  error: string | null;
  onChange: (dataUrl: string | null) => void;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [liveStatus, setLiveStatus] = useState(status);
  const [liveUrl, setLiveUrl] = useState(value);
  const [liveError, setLiveError] = useState(error);

  useEffect(() => {
    setLiveUrl(value);
  }, [value]);

  // While the job runs, poll for the finished image. Cheap read, stops as soon as it settles.
  useEffect(() => {
    if (liveStatus !== "generating") return;
    const t = setInterval(async () => {
      try {
        const res = await fetch(`/api/blog/posts/${postId}/image-status`);
        if (!res.ok) return;
        const d = await res.json();
        setLiveStatus(d.status);
        setLiveError(d.error ?? null);
        if (d.status === "ready" && d.featured_image_url) {
          setLiveUrl(d.featured_image_url);
          onChange(d.featured_image_url);
        }
      } catch {
        /* transient — keep polling */
      }
    }, 4000);
    return () => clearInterval(t);
  }, [liveStatus, postId, onChange]);

  async function upload(file: File) {
    setBusy(true);
    setLocalError(null);
    try {
      const dataUrl = await resizeToDataUrl(file);
      setLiveUrl(dataUrl);
      setLiveStatus("ready");
      onChange(dataUrl);
    } catch (err: any) {
      setLocalError(err?.message ?? "Could not read that image");
    } finally {
      setBusy(false);
    }
  }

  const { refresh: refreshCredits } = useCredits();

  async function generate() {
    setBusy(true);
    setLocalError(null);
    try {
      const res = await fetch(`/api/blog/posts/${postId}/generate-image`, { method: "POST" });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "Could not start generation");
      refreshCredits();
      setLiveStatus("generating");
      setLiveError(null);
    } catch (err: any) {
      setLocalError(err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  }

  const generating = liveStatus === "generating";

  return (
    <div className="space-y-2">
      <div className="text-xs font-medium text-zinc-400">Featured image</div>
      <div className="flex flex-wrap items-start gap-3">
        <div className="relative h-24 w-40 shrink-0 overflow-hidden rounded-lg border border-ink-600 bg-ink-800">
          {liveUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={liveUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full items-center justify-center text-[12px] text-zinc-600">No image</div>
          )}
          {generating && (
            <div className="absolute inset-0 flex items-center justify-center bg-ink-950/70 text-emerald-300">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={busy || generating} variant="outline" className="text-xs">
              <ImagePlus className="h-3.5 w-3.5" /> Upload
            </Button>
            <Button type="button" onClick={generate} disabled={busy || generating} variant="outline" className="text-xs">
              {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              {generating ? "Generating…" : "Generate with AI"}
              <CostBadge jobType="generate_blog_image" />
            </Button>
            {liveUrl && !generating && (
              <Button
                type="button"
                onClick={() => {
                  setLiveUrl(null);
                  setLiveStatus("none");
                  onChange(null);
                }} variant="outline" className="text-xs">
                <Trash2 className="h-3.5 w-3.5" /> Remove
              </Button>
            )}
          </div>
          <p className="text-[12px] text-zinc-500">
            Shown as the hero on the post and the thumbnail on your blog index. Wide (16:9) works best.
          </p>
        </div>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) upload(f);
          e.target.value = "";
        }}
      />
      {(localError || (liveStatus === "failed" && liveError)) && (
        <p className="text-xs text-red-300">{localError ?? liveError}</p>
      )}
    </div>
  );
}

// Downscale client-side so a phone photo lands under the server's cap. Server validation
// (isValidImageDataUrl) remains the real boundary — this is UX only. Wider max edge than the
// inline block-image helper since this renders full-bleed.
const MAX_CHARS = 900_000;
async function resizeToDataUrl(file: File): Promise<string> {
  const raw: string = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("Could not read image"));
    img.src = raw;
  });
  let maxDim = 1600;
  let quality = 0.85;
  for (let i = 0; i < 5; i++) {
    const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return raw;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const out = canvas.toDataURL("image/jpeg", quality);
    if (out.length <= MAX_CHARS) return out;
    maxDim = Math.round(maxDim * 0.75);
    quality = Math.max(0.5, quality - 0.1);
  }
  throw new Error("Image is too large even after compression — try a smaller file.");
}
