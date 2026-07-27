"use client";

import { useEffect, useState } from "react";
import { Instagram, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type ActiveIg = { ig_user_id: string; ig_username: string } | null;

export default function PostToInstagram({
  campaignId,
  defaultCaption,
  hasImage,
}: {
  campaignId: string;
  defaultCaption: string;
  hasImage: boolean;
}) {
  const [loading, setLoading] = useState(true);
  const [activeIg, setActiveIg] = useState<ActiveIg>(null);
  const [caption, setCaption] = useState(defaultCaption);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  useEffect(() => {
    createClient()
      .rpc("get_meta_connection_status")
      .then(({ data }: { data: any }) => {
        const accounts = (data?.instagram_accounts ?? []) as {
          ig_user_id: string;
          ig_username: string;
          is_active: boolean;
        }[];
        const active = accounts.find((a) => a.is_active);
        setActiveIg(active ? { ig_user_id: active.ig_user_id, ig_username: active.ig_username } : null);
        setLoading(false);
      });
  }, []);

  useEffect(() => setCaption(defaultCaption), [defaultCaption]);

  if (loading) return null;

  if (!activeIg) {
    return (
      <div className="rounded-lg border border-ink-700 bg-ink-800/50 p-4 text-sm text-zinc-400">
        No Instagram Business account linked. Connect Facebook in{" "}
        <a href="/connections" className="text-emerald-400 underline">
          Connections
        </a>{" "}
        with a Page that has a linked Instagram Business account.
      </div>
    );
  }

  if (!hasImage) {
    return (
      <div className="rounded-lg border border-ink-700 bg-ink-800/50 p-4 text-sm text-zinc-400">
        Instagram requires an image — this campaign doesn't have one embedded.
      </div>
    );
  }

  async function publish() {
    setBusy(true);
    setResult(null);
    const res = await fetch("/api/instagram/post", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ig_user_id: activeIg!.ig_user_id,
        caption,
        campaign_id: campaignId,
        idempotency_key: idempotencyKey,
      }),
    });
    const data = await res.json();
    setBusy(false);
    if (res.ok) {
      setResult({ ok: true, text: "Posted!" });
      setIdempotencyKey(crypto.randomUUID());
    } else {
      setResult({ ok: false, text: data.error ?? "Failed to publish" });
    }
  }

  return (
    <div className="rounded-lg border border-ink-700 p-4">
      <div className="mb-2 flex items-center gap-2 text-xs text-zinc-500">
        <Instagram className="h-3.5 w-3.5" /> Posting to @{activeIg.ig_username} — edit down to one
        caption before publishing
      </div>
      <textarea
        value={caption}
        onChange={(e) => setCaption(e.target.value)}
        rows={4}
        className="w-full rounded-lg border border-ink-600 bg-ink-900 p-3 text-sm outline-none focus:border-emerald-500"
      />
      <div className="mt-2 flex items-center gap-2">
        <button onClick={publish} disabled={busy || !caption.trim()} className="btn-primary">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Instagram className="h-4 w-4" />}
          Post to Instagram
        </button>
        {result && (
          <span className={`text-sm ${result.ok ? "text-emerald-400" : "text-red-400"}`}>
            {result.text}
          </span>
        )}
      </div>
    </div>
  );
}
