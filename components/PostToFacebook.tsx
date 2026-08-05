"use client";

import { useEffect, useState } from "react";
import { Facebook, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

type ActivePage = { page_id: string; page_name: string } | null;

export default function PostToFacebook({
  campaignId,
  defaultMessage,
  imageUrl,
}: {
  campaignId: string;
  defaultMessage: string;
  imageUrl: string | null;
}) {
  const [loading, setLoading] = useState(true);
  const [activePage, setActivePage] = useState<ActivePage>(null);
  const [message, setMessage] = useState(defaultMessage);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  useEffect(() => {
    createClient()
      .rpc("get_meta_connection_status")
      .then(({ data }: { data: any }) => {
        const pages = (data?.pages ?? []) as {
          page_id: string;
          page_name: string;
          is_active: boolean;
          status: string;
        }[];
        const active = pages.find((p) => p.is_active && p.status === "connected");
        setActivePage(active ? { page_id: active.page_id, page_name: active.page_name } : null);
        setLoading(false);
      });
  }, []);

  useEffect(() => setMessage(defaultMessage), [defaultMessage]);

  if (loading) return null;

  if (!activePage) {
    return (
      <div className="rounded-lg border border-ink-700 bg-ink-800/50 p-4 text-sm text-zinc-400">
        Connect Facebook in{" "}
        <a href="/settings/integrations" className="text-emerald-400 underline">
          Integrations
        </a>{" "}
        to publish this directly.
      </div>
    );
  }

  async function publish() {
    setBusy(true);
    setResult(null);
    const res = await fetch("/api/meta/post", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        page_id: activePage!.page_id,
        message,
        image_url: imageUrl ?? undefined,
        campaign_id: campaignId,
        idempotency_key: idempotencyKey,
      }),
    });
    const data = await res.json();
    setBusy(false);
    if (res.ok) {
      setResult({ ok: true, text: "Posted!" });
      setIdempotencyKey(crypto.randomUUID()); // fresh key for the next post; retries of this one stay idempotent
    } else {
      setResult({ ok: false, text: data.error ?? "Failed to publish" });
    }
  }

  return (
    <div className="rounded-lg border border-ink-700 p-4">
      <div className="mb-2 flex items-center gap-2 text-xs text-zinc-500">
        <Facebook className="h-3.5 w-3.5" /> Posting to {activePage.page_name} — edit down to one
        caption before publishing
      </div>
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        rows={4}
        className="w-full rounded-lg border border-ink-600 bg-ink-900 p-3 text-sm outline-none focus:border-emerald-500"
      />
      <div className="mt-2 flex items-center gap-2">
        <Button onClick={publish} disabled={busy || !message.trim()}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Facebook className="h-4 w-4" />}
          Post to Facebook
        </Button>
        {result && (
          <span className={`text-sm ${result.ok ? "text-emerald-400" : "text-red-400"}`}>
            {result.text}
          </span>
        )}
      </div>
    </div>
  );
}
