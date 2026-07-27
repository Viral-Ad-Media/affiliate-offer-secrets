"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Mail } from "lucide-react";

type Status = { connected: boolean; status?: string; email_address?: string };

export default function MailPanel({ status }: { status: Status }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function disconnect() {
    setBusy(true);
    await fetch("/api/mail/disconnect", { method: "POST" });
    router.refresh();
    setBusy(false);
  }

  if (!status.connected) {
    return (
      <div className="card p-5">
        <h2 className="mb-1 text-sm font-semibold text-zinc-100">Connect Mail</h2>
        <p className="mb-4 text-sm text-zinc-400">
          Connect your Gmail account to send the generated email swipe copy from your own inbox.
        </p>
        <a href="/api/mail/connect" className="btn-primary inline-flex w-fit">
          <Mail className="h-4 w-4" /> Connect Gmail
        </a>
      </div>
    );
  }

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold text-zinc-100">Connected as {status.email_address}</div>
          {status.status === "needs_reconnect" && (
            <div className="text-xs text-amber-400">Needs reconnect</div>
          )}
        </div>
        <button onClick={disconnect} disabled={busy} className="btn-ghost !py-1 text-xs">
          Disconnect
        </button>
      </div>
    </div>
  );
}
