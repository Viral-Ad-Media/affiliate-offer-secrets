"use client";

import { useState } from "react";
import { Link2, Loader2, CheckCircle2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Network } from "@/lib/engine/renderPages";

type NetworkConfig = {
  network: Network;
  label: string;
  fieldLabel: string;
  helpText: string;
};

// Digistore24 joins this list once its own connect flow lands (see Phase G's plan doc) — the
// form below is already network-agnostic, no changes needed here to add it.
const NETWORKS: NetworkConfig[] = [
  {
    network: "clickbank",
    label: "ClickBank",
    fieldLabel: "Affiliate nickname",
    helpText: "The nickname from your ClickBank account — used to build your unique hoplinks.",
  },
];

export default function NetworkConnectionsPanel({
  userId,
  initialConnections,
}: {
  userId: string;
  initialConnections: Record<string, string>;
}) {
  return (
    <div className="space-y-3">
      {NETWORKS.map((cfg) => (
        <NetworkCard key={cfg.network} userId={userId} config={cfg} initialValue={initialConnections[cfg.network] ?? ""} />
      ))}
    </div>
  );
}

function NetworkCard({
  userId,
  config,
  initialValue,
}: {
  userId: string;
  config: NetworkConfig;
  initialValue: string;
}) {
  const [value, setValue] = useState(initialValue);
  const [saved, setSaved] = useState(initialValue);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  async function save() {
    const trimmed = value.trim();
    if (!trimmed) {
      setError("Required");
      return;
    }
    if (!/^[A-Za-z0-9_.-]{1,64}$/.test(trimmed)) {
      setError("Letters, numbers, and . _ - only");
      return;
    }
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error: upsertErr } = await supabase
      .from("network_connections")
      .upsert(
        { user_id: userId, network: config.network, affiliate_id: trimmed, updated_at: new Date().toISOString() },
        { onConflict: "user_id,network" }
      );
    setBusy(false);
    if (upsertErr) {
      setError("Couldn't save — check the format and try again");
      return;
    }
    setSaved(trimmed);
    setJustSaved(true);
    setTimeout(() => setJustSaved(false), 2000);
  }

  return (
    <div className="card p-5">
      <div className="mb-1 flex items-center gap-2">
        <Link2 className="h-4 w-4 text-zinc-400" />
        <h2 className="text-sm font-semibold text-zinc-100">{config.label}</h2>
        {saved && (
          <span className="ml-auto rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-300">
            Connected
          </span>
        )}
      </div>
      <p className="mb-4 text-sm text-zinc-400">{config.helpText}</p>
      <div className="flex items-center gap-2">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={config.fieldLabel}
          className="w-full max-w-xs rounded-lg border border-ink-600 bg-ink-900 px-3 py-2 text-sm outline-none focus:border-emerald-500"
        />
        <button onClick={save} disabled={busy || !value.trim()} className="btn-primary !py-2 text-xs">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : justSaved ? <CheckCircle2 className="h-3.5 w-3.5" /> : null}
          {saved ? "Update" : "Connect"}
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
    </div>
  );
}
