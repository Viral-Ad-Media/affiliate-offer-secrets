"use client";

import { useEffect, useState } from "react";
import { useCredits } from "@/components/CreditsProvider";
import CostBadge from "@/components/CostBadge";
import ModelPicker from "@/components/ModelPicker";
import { Video, Loader2, Instagram, Music2, Sparkles } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import GenerationProgress from "@/components/GenerationProgress";

type VideoStatus = "none" | "generating" | "ready" | "failed";

type PlatformTarget = {
  key: "instagram" | "tiktok";
  label: string;
  icon: typeof Instagram;
  available: boolean;
  extra?: { igUserId?: string };
};

export default function GenerateVideo({
  campaignId,
  productTitle,
  defaultCaption,
}: {
  campaignId: string;
  productTitle: string;
  defaultCaption: string;
}) {
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<VideoStatus>("none");
  const [videoError, setVideoError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [igUserId, setIgUserId] = useState<string | null>(null);
  const [tiktokConnected, setTiktokConnected] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, { ok: boolean; text: string }>>({});
  const [caption, setCaption] = useState(defaultCaption);
  const [idempotencyKeys, setIdempotencyKeys] = useState<Record<string, string>>({
    instagram: crypto.randomUUID(),
    tiktok: crypto.randomUUID(),
  });

  async function refreshStatus() {
    const supabase = createClient();
    const { data } = await supabase
      .from("campaigns")
      .select("video_status, video_error")
      .eq("id", campaignId)
      .maybeSingle();
    const s = ((data as any)?.video_status ?? "none") as VideoStatus;
    setStatus(s);
    setVideoError((data as any)?.video_error ?? null);
    return s;
  }

  useEffect(() => {
    const supabase = createClient();
    Promise.all([
      refreshStatus(),
      supabase.rpc("get_meta_connection_status"),
      supabase.rpc("get_tiktok_connection_status"),
    ]).then(([, meta, tiktok]: any[]) => {
      const accounts = (meta.data?.instagram_accounts ?? []) as { ig_user_id: string; is_active: boolean }[];
      const active = accounts.find((a) => a.is_active);
      setIgUserId(active?.ig_user_id ?? null);
      setTiktokConnected(!!tiktok.data?.connected);
      setLoading(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId]);

  useEffect(() => setCaption(defaultCaption), [defaultCaption]);

  useEffect(() => {
    if (status !== "generating") return;
    const t = setInterval(async () => {
      const s = await refreshStatus();
      if (s !== "generating") clearInterval(t);
    }, 5000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  useEffect(() => {
    if (status !== "ready") return;
    fetch(`/api/campaigns/${campaignId}/video-url`)
      .then((r) => r.json())
      .then((d) => setPreviewUrl(d.url ?? null));
  }, [status, campaignId]);

  const { refresh: refreshCredits } = useCredits();

  const [videoModel, setVideoModel] = useState("");

  async function generate() {
    setBusy("generate");
    setVideoError(null);
    const res = await fetch(`/api/campaigns/${campaignId}/generate-video`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // "" = no override; the server resolves the workspace default at queue time.
      body: JSON.stringify(videoModel ? { model: videoModel } : {}),
    });
    const data = await res.json();
    setBusy(null);
    if (!res.ok) {
      setVideoError(data.error ?? "Failed to start generation");
      return;
    }
    refreshCredits();
    setStatus("generating");
  }

  async function post(target: PlatformTarget["key"], endpoint: string, body: Record<string, unknown>) {
    setBusy(target);
    setResults((r) => ({ ...r, [target]: undefined as any }));
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...body, campaign_id: campaignId, idempotency_key: idempotencyKeys[target] }),
    });
    const data = await res.json();
    setBusy(null);
    if (res.ok) {
      setResults((r) => ({ ...r, [target]: { ok: true, text: "Posted!" } }));
      setIdempotencyKeys((k) => ({ ...k, [target]: crypto.randomUUID() }));
    } else {
      setResults((r) => ({ ...r, [target]: { ok: false, text: data.error ?? "Failed to post" } }));
    }
  }

  if (loading) return null;

  const targets: PlatformTarget[] = [
    { key: "instagram", label: "Instagram Reels", icon: Instagram, available: !!igUserId },
    { key: "tiktok", label: "TikTok", icon: Music2, available: tiktokConnected },
  ];

  return (
    <div className="rounded-lg border border-ink-700 p-4">
      <div className="mb-3 flex items-center gap-2 text-xs text-zinc-500">
        <Video className="h-3.5 w-3.5" /> AI-generated short-form video for {productTitle}
      </div>

      {status === "none" || status === "failed" ? (
        <>
          {status === "failed" && videoError && (
            <p className="mb-2 text-sm text-red-300">Generation failed: {videoError}</p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={generate} disabled={busy === "generate"}>
              {busy === "generate" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Generate video
              <CostBadge jobType="generate_video" />
            </Button>
            <ModelPicker kind="video" value={videoModel} onChange={setVideoModel} disabled={busy === "generate"} />
          </div>
        </>
      ) : status === "generating" ? (
        <div className="rounded-lg border border-sky-500/30 bg-sky-500/10 px-4 py-3">
          <GenerationProgress jobType="generate_video" matchKey="campaign_id" matchValue={campaignId} />
        </div>
      ) : (
        <div className="space-y-3">
          {previewUrl && (
            <video src={previewUrl} controls className="w-full max-w-xs rounded-lg border border-ink-700" />
          )}
          <textarea
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            rows={3}
            placeholder="Caption"
            className="w-full rounded-lg border border-ink-600 bg-ink-900 p-3 text-sm outline-none focus:border-emerald-500"
          />
          <div className="flex flex-wrap gap-2">
            {targets.map((t) => (
              <div key={t.key} className="flex items-center gap-2">
                <Button
                  onClick={() =>
                    t.key === "instagram"
                      ? post("instagram", "/api/instagram/post-reel", { ig_user_id: igUserId, caption })
                      : post("tiktok", "/api/tiktok/post-video", { caption })
                  }
                  disabled={!t.available || busy === t.key || !caption.trim()}
                  
                  title={t.available ? undefined : `Connect ${t.label} in Integrations first`} variant="outline" className="text-xs">
                  {busy === t.key ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <t.icon className="h-3.5 w-3.5" />}
                  Post to {t.label}
                </Button>
                {results[t.key] && (
                  <span className={`text-xs ${results[t.key].ok ? "text-emerald-400" : "text-red-400"}`}>
                    {results[t.key].text}
                  </span>
                )}
              </div>
            ))}
          </div>
          <Button onClick={generate} disabled={busy === "generate"} variant="outline" className="text-xs">
            {busy === "generate" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            Regenerate
          </Button>
        </div>
      )}
    </div>
  );
}
