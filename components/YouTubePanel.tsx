"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Youtube } from "lucide-react";

type Status = { connected: boolean; status?: string; channel_title?: string; thumbnail_url?: string };

export default function YouTubePanel({ status }: { status: Status }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function disconnect() {
    setBusy(true);
    await fetch("/api/youtube/disconnect", { method: "POST" });
    router.refresh();
    setBusy(false);
  }

  if (!status.connected) {
    return (
      <div className="card p-5">
        <h2 className="mb-1 text-sm font-semibold text-zinc-100">Connect YouTube</h2>
        <p className="mb-4 text-sm text-zinc-400">
          Connect your YouTube channel now so it's ready the moment video posting ships.
        </p>
        <a href="/api/youtube/connect" className="btn-primary inline-flex w-fit">
          <Youtube className="h-4 w-4" /> Connect YouTube
        </a>
      </div>
    );
  }

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {status.thumbnail_url && (
            <img src={status.thumbnail_url} alt="" className="h-8 w-8 rounded-full" />
          )}
          <div>
            <div className="text-sm font-semibold text-zinc-100">{status.channel_title}</div>
            {status.status === "needs_reconnect" && (
              <div className="text-xs text-amber-400">Needs reconnect</div>
            )}
          </div>
        </div>
        <button onClick={disconnect} disabled={busy} className="btn-ghost !py-1 text-xs">
          Disconnect
        </button>
      </div>
    </div>
  );
}
