"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Music2 } from "lucide-react";
import { Button } from "@/components/ui/button";

type Status = { connected: boolean; status?: string; tiktok_username?: string; avatar_url?: string };

export default function TikTokPanel({ status }: { status: Status }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function disconnect() {
    setBusy(true);
    await fetch("/api/tiktok/disconnect", { method: "POST" });
    router.refresh();
    setBusy(false);
  }

  if (!status.connected) {
    return (
      <div className="card p-5">
        <h2 className="mb-1 text-sm font-semibold text-zinc-100">Connect TikTok</h2>
        <p className="mb-4 text-sm text-zinc-400">
          Connect your TikTok account now so it's ready the moment video posting ships.
        </p>
        <a href="/api/tiktok/connect" className="btn-primary inline-flex w-fit">
          <Music2 className="h-4 w-4" /> Connect TikTok
        </a>
      </div>
    );
  }

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {status.avatar_url && (
            <img src={status.avatar_url} alt="" className="h-8 w-8 rounded-full" />
          )}
          <div>
            <div className="text-sm font-semibold text-zinc-100">
              Connected as @{status.tiktok_username}
            </div>
            {status.status === "needs_reconnect" && (
              <div className="text-xs text-amber-400">Needs reconnect</div>
            )}
          </div>
        </div>
        <Button onClick={disconnect} disabled={busy} variant="outline" className="!py-1 text-xs">
          Disconnect
        </Button>
      </div>
    </div>
  );
}
