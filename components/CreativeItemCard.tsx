"use client";

import { useEffect, useState } from "react";
import { useCredits } from "@/components/CreditsProvider";
import CostBadge from "@/components/CostBadge";
import ModelPicker from "@/components/ModelPicker";
import { Image as ImageIcon, Video, Loader2, Sparkles } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { CreativeKind, CreativeSource, CreativeStatus } from "@/lib/shared";
import { Button } from "@/components/ui/button";
import GenerationProgress from "@/components/GenerationProgress";

type CreativeState = {
  status: CreativeStatus;
  image_data_url: string | null;
  video_path: string | null;
  error: string | null;
};

const EMPTY: CreativeState = { status: "none", image_data_url: null, video_path: null, error: null };

// Generate Image / Generate Video buttons for one ad angle or social post, each kind tracked
// independently (a card can have an image generating while a video is already ready, etc). Same
// poll-until-not-generating pattern GenerateVideo.tsx/LaunchAd.tsx already use, just per-kind.
export default function CreativeItemCard({
  campaignId,
  source,
  itemIndex,
}: {
  campaignId: string;
  source: CreativeSource;
  itemIndex: number;
}) {
  const [loading, setLoading] = useState(true);
  const [image, setImage] = useState<CreativeState>(EMPTY);
  const [video, setVideo] = useState<CreativeState>(EMPTY);
  const [videoPreviewUrl, setVideoPreviewUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState<CreativeKind | null>(null);
  const [imageCreativeId, setImageCreativeId] = useState<string | null>(null);
  const [videoCreativeId, setVideoCreativeId] = useState<string | null>(null);

  async function refresh() {
    const supabase = createClient();
    const { data } = await supabase
      .from("campaign_creatives")
      .select("id, kind, status, image_data_url, video_path, error")
      .eq("campaign_id", campaignId)
      .eq("source", source)
      .eq("item_index", itemIndex);
    const rows = (data ?? []) as any[];
    const img = rows.find((r) => r.kind === "image");
    const vid = rows.find((r) => r.kind === "video");
    setImage(img ? { status: img.status, image_data_url: img.image_data_url, video_path: null, error: img.error } : EMPTY);
    setVideo(vid ? { status: vid.status, image_data_url: null, video_path: vid.video_path, error: vid.error } : EMPTY);
    setImageCreativeId(img?.id ?? null);
    setVideoCreativeId(vid?.id ?? null);
    return { imgStatus: img?.status ?? "none", vidStatus: vid?.status ?? "none" };
  }

  useEffect(() => {
    refresh().then(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId, source, itemIndex]);

  useEffect(() => {
    if (image.status !== "generating" && video.status !== "generating") return;
    const t = setInterval(async () => {
      const { imgStatus, vidStatus } = await refresh();
      if (imgStatus !== "generating" && vidStatus !== "generating") clearInterval(t);
    }, 4000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image.status, video.status]);

  useEffect(() => {
    if (video.status !== "ready" || !videoCreativeId) {
      setVideoPreviewUrl(null);
      return;
    }
    fetch(`/api/campaign-creatives/${videoCreativeId}/video-url`)
      .then((r) => r.json())
      .then((d) => setVideoPreviewUrl(d.url ?? null));
  }, [video.status, videoCreativeId]);

  const { refresh: refreshCredits } = useCredits();
  // A one-off override per kind. "" means send nothing and let the server resolve the workspace
  // default at queue time — so changing that default takes effect for anyone who never touched
  // this, rather than being frozen into whatever was current when the page rendered.
  const [imageModel, setImageModel] = useState("");
  const [videoModel, setVideoModel] = useState("");

  async function generate(kind: CreativeKind) {
    setBusy(kind);
    const model = kind === "image" ? imageModel : videoModel;
    const res = await fetch("/api/campaign-creatives/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        campaign_id: campaignId,
        source,
        item_index: itemIndex,
        kind,
        ...(model ? { model } : {}),
      }),
    });
    const data = await res.json();
    setBusy(null);
    if (!res.ok) {
      if (kind === "image") setImage((s) => ({ ...s, status: "failed", error: data.error ?? "Failed to start" }));
      else setVideo((s) => ({ ...s, status: "failed", error: data.error ?? "Failed to start" }));
      return;
    }
    // The charge already happened server-side; pull the new balance so every cost badge on the
    // page reflects it without a full reload.
    refreshCredits();
    if (kind === "image") setImage((s) => ({ ...s, status: "generating", error: null }));
    else setVideo((s) => ({ ...s, status: "generating", error: null }));
  }

  if (loading) return null;

  return (
    <div className="mt-2 grid gap-2 sm:grid-cols-2">
      <div className="rounded-lg border border-ink-700 p-2.5">
        <div className="mb-1.5 flex items-center gap-1.5 text-xs text-zinc-500">
          <ImageIcon className="h-3.5 w-3.5" /> Image creative
        </div>
        {image.status === "generating" ? (
          imageCreativeId ? (
            <GenerationProgress
              jobType="generate_creative_image"
              matchKey="campaign_creative_id"
              matchValue={imageCreativeId}
            />
          ) : (
            // The claim row exists before the poll has read its id back — one tick, then the bar.
            <div className="flex items-center gap-1.5 text-xs text-sky-300">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Starting…
            </div>
          )
        ) : image.status === "ready" && image.image_data_url ? (
          <div className="space-y-1.5">
            <img src={image.image_data_url} alt="" className="h-24 w-24 rounded-lg border border-ink-700 object-cover" />
            <Button onClick={() => generate("image")} disabled={busy === "image"} variant="outline" className="!py-1 text-xs">
              {busy === "image" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              Regenerate
            </Button>
          </div>
        ) : (
          <>
            {image.status === "failed" && image.error && (
              <p className="mb-1.5 text-xs text-red-300">{image.error}</p>
            )}
            <div className="flex flex-wrap items-center gap-1.5">
              <Button onClick={() => generate("image")} disabled={busy === "image"} variant="outline" className="!py-1 text-xs">
                {busy === "image" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                Generate image
                <CostBadge jobType="generate_creative_image" />
              </Button>
              <ModelPicker kind="image" value={imageModel} onChange={setImageModel} disabled={busy === "image"} />
            </div>
          </>
        )}
      </div>

      <div className="rounded-lg border border-ink-700 p-2.5">
        <div className="mb-1.5 flex items-center gap-1.5 text-xs text-zinc-500">
          <Video className="h-3.5 w-3.5" /> Video creative
        </div>
        {video.status === "generating" ? (
          videoCreativeId ? (
            <GenerationProgress
              jobType="generate_creative_video"
              matchKey="campaign_creative_id"
              matchValue={videoCreativeId}
            />
          ) : (
            <div className="flex items-center gap-1.5 text-xs text-sky-300">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Starting…
            </div>
          )
        ) : video.status === "ready" ? (
          <div className="space-y-1.5">
            {videoPreviewUrl && (
              <video src={videoPreviewUrl} controls className="h-24 w-24 rounded-lg border border-ink-700 object-cover" />
            )}
            <Button onClick={() => generate("video")} disabled={busy === "video"} variant="outline" className="!py-1 text-xs">
              {busy === "video" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              Regenerate
            </Button>
          </div>
        ) : (
          <>
            {video.status === "failed" && video.error && (
              <p className="mb-1.5 text-xs text-red-300">{video.error}</p>
            )}
            <div className="flex flex-wrap items-center gap-1.5">
              <Button onClick={() => generate("video")} disabled={busy === "video"} variant="outline" className="!py-1 text-xs">
                {busy === "video" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                Generate video
                <CostBadge jobType="generate_creative_video" />
              </Button>
              <ModelPicker kind="video" value={videoModel} onChange={setVideoModel} disabled={busy === "video"} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
