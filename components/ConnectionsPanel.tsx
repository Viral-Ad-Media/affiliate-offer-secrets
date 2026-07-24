"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Facebook, RefreshCw } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type Page = { page_id: string; page_name: string; is_active: boolean; status: string };
type Status = { connected: boolean; status?: string; pages?: Page[] };

export default function ConnectionsPanel({ status }: { status: Status }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  async function setActive(pageId: string) {
    setBusy(pageId);
    await createClient().rpc("set_active_meta_page", { p_page_id: pageId });
    router.refresh();
    setBusy(null);
  }

  async function disconnect() {
    setBusy("disconnect");
    await fetch("/api/meta/disconnect", { method: "POST" });
    router.refresh();
    setBusy(null);
  }

  if (!status.connected) {
    return (
      <div className="card p-5">
        <h2 className="mb-1 text-sm font-semibold text-zinc-100">Connect Facebook</h2>
        <p className="mb-4 text-sm text-zinc-400">
          Connect your Facebook Page to publish generated captions with one click.
        </p>
        <a href="/api/meta/connect" className="btn-primary inline-flex w-fit">
          <Facebook className="h-4 w-4" /> Connect Facebook
        </a>
      </div>
    );
  }

  const needsReconnect = status.status === "needs_reconnect";
  const pages = status.pages ?? [];

  return (
    <div className="space-y-4">
      {needsReconnect && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-300">
          Your Facebook connection needs to be renewed.{" "}
          <a href="/api/meta/connect" className="underline">
            Reconnect
          </a>
        </div>
      )}
      <div className="card p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-100">Connected Pages</h2>
          <button
            onClick={disconnect}
            disabled={busy === "disconnect"}
            className="btn-ghost !py-1 text-xs"
          >
            Disconnect
          </button>
        </div>
        <ul className="space-y-2">
          {pages.map((p) => (
            <li
              key={p.page_id}
              className="flex items-center justify-between rounded-lg border border-ink-700 px-3 py-2.5"
            >
              <div>
                <div className="text-sm text-zinc-100">{p.page_name}</div>
                {p.status === "needs_reconnect" && (
                  <div className="text-xs text-amber-400">Needs reconnect</div>
                )}
              </div>
              {p.is_active ? (
                <span className="chip border-emerald-500/30 bg-emerald-500/15 text-emerald-300">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Active
                </span>
              ) : (
                <button
                  onClick={() => setActive(p.page_id)}
                  disabled={busy === p.page_id}
                  className="btn-ghost !py-1 text-xs"
                >
                  {busy === p.page_id ? (
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    "Set active"
                  )}
                </button>
              )}
            </li>
          ))}
          {pages.length === 0 && (
            <li className="text-sm text-zinc-500">No Pages found for this Facebook account.</li>
          )}
        </ul>
      </div>
    </div>
  );
}
