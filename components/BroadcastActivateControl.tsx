"use client";

import { useEffect, useState } from "react";
import { Loader2, Play, Pause, PlayCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { BroadcastSequence } from "@/lib/shared";

type Stats = { enrolled: number; pending: number; queued: number; sent: number; failed: number; skipped: number };

export default function BroadcastActivateControl({
  sequence,
  stepCount,
  selectedContactCount,
  stats,
  onChanged,
}: {
  sequence: BroadcastSequence;
  stepCount: number;
  selectedContactCount: number;
  stats: Stats;
  onChanged: () => void;
}) {
  const [mailConnected, setMailConnected] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Gates on the account's active sender — whichever provider is configured.
    createClient()
      .rpc("get_active_mail_sender")
      .then(({ data }: { data: any }) => setMailConnected(!!data?.connected));
  }, []);

  async function activate() {
    setBusy(true);
    setError(null);
    const { error: err } = await createClient().rpc("activate_broadcast_sequence", { p_sequence_id: sequence.id });
    setBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    onChanged();
  }

  async function pause() {
    setBusy(true);
    await createClient().rpc("pause_broadcast_sequence", { p_sequence_id: sequence.id });
    setBusy(false);
    onChanged();
  }

  async function resume() {
    setBusy(true);
    setError(null);
    const { error: err } = await createClient().rpc("resume_broadcast_sequence", { p_sequence_id: sequence.id });
    setBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    onChanged();
  }

  const canActivate = stepCount > 0 && (sequence.audience_type !== "manual" || selectedContactCount > 0);

  return (
    <section className="card p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="grid grid-cols-3 gap-4 text-sm sm:grid-cols-6">
          <div>
            <div className="text-xs text-zinc-500">Enrolled</div>
            <div className="font-semibold text-zinc-100">{stats.enrolled}</div>
          </div>
          <div>
            <div className="text-xs text-zinc-500">Pending</div>
            <div className="font-semibold text-zinc-100">{stats.pending}</div>
          </div>
          <div>
            <div className="text-xs text-zinc-500">Queued</div>
            <div className="font-semibold text-zinc-100">{stats.queued}</div>
          </div>
          <div>
            <div className="text-xs text-zinc-500">Sent</div>
            <div className="font-semibold text-emerald-400">{stats.sent}</div>
          </div>
          <div>
            <div className="text-xs text-zinc-500">Failed</div>
            <div className="font-semibold text-red-400">{stats.failed}</div>
          </div>
          <div>
            <div className="text-xs text-zinc-500">Skipped</div>
            <div className="font-semibold text-zinc-500">{stats.skipped}</div>
          </div>
        </div>
      </div>

      {mailConnected === false && (
        <div className="mb-3 rounded-lg border border-ink-700 bg-ink-800/50 p-3 text-xs text-zinc-400">
          Connect an email sender (Resend, SendGrid, Mailgun, or SMTP) in{" "}
          <a href="/settings/integrations" className="text-emerald-400 underline">
            Integrations
          </a>{" "}
          before activating a sequence.
        </div>
      )}

      <div className="flex items-center gap-2">
        {sequence.status === "draft" && (
          <button onClick={activate} disabled={busy || !canActivate || !mailConnected} className="btn-primary">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            Activate
          </button>
        )}
        {sequence.status === "active" && (
          <button onClick={pause} disabled={busy} className="btn-ghost">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pause className="h-4 w-4" />}
            Pause
          </button>
        )}
        {sequence.status === "paused" && (
          <button onClick={resume} disabled={busy || !mailConnected} className="btn-primary">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
            Resume
          </button>
        )}
        {!canActivate && sequence.status === "draft" && (
          <p className="text-xs text-zinc-500">
            {stepCount === 0
              ? "Add at least one step before activating."
              : "Pick at least one contact before activating."}
          </p>
        )}
      </div>
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
    </section>
  );
}
