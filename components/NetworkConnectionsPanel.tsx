"use client";

import { useState } from "react";
import { Link2, Loader2, CheckCircle2 } from "lucide-react";
import type { Network } from "@/lib/engine/renderPages";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

type NetworkConfig = {
  network: Network;
  label: string;
  fieldLabel: string;
  helpText: string;
};

const NETWORKS: NetworkConfig[] = [
  {
    network: "clickbank",
    label: "ClickBank",
    fieldLabel: "Affiliate nickname",
    helpText: "The nickname from your ClickBank account — used to build your unique hoplinks.",
  },
  {
    network: "digistore24",
    label: "Digistore24",
    fieldLabel: "Affiliate ID",
    helpText: "Your Digistore24 Affiliate ID — used to build your unique promolinks.",
  },
];

export default function NetworkConnectionsPanel({
  userId,
  workspaceId,
  initialConnections,
}: {
  userId: string;
  workspaceId: string;
  initialConnections: Record<string, string>;
}) {
  return (
    <div className="space-y-3">
      {NETWORKS.map((cfg) => (
        <NetworkCard key={cfg.network} userId={userId} workspaceId={workspaceId} config={cfg} initialValue={initialConnections[cfg.network] ?? ""} />
      ))}
    </div>
  );
}

function NetworkCard({
  userId,
  workspaceId,
  config,
  initialValue,
}: {
  userId: string;
  workspaceId: string;
  config: NetworkConfig;
  initialValue: string;
}) {
  const [value, setValue] = useState(initialValue);
  const [saved, setSaved] = useState(initialValue);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const [rerendered, setRerendered] = useState(0);

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
    // Through the route, not a direct upsert. Saving the id is only half the job: hoplinks are
    // baked into each page's stored HTML at render time, so without the re-render this route does,
    // changing a nickname updated the row and left every existing funnel crediting the old one —
    // with the UI saying "Connected" the whole time.
    let res: Response;
    try {
      res = await fetch("/api/network-connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ network: config.network, affiliate_id: trimmed }),
      });
    } catch {
      setBusy(false);
      setError("Couldn't save — check your connection and try again");
      return;
    }
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "Couldn't save — check the format and try again");
      return;
    }
    setSaved(trimmed);
    setRerendered(typeof data.rerendered === "number" ? data.rerendered : 0);
    setJustSaved(true);
    setTimeout(() => setJustSaved(false), 4000);
  }

  return (
    <Card className="p-5">
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
        <Button onClick={save} disabled={busy || !value.trim()} className="!py-2 text-xs">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : justSaved ? <CheckCircle2 className="h-3.5 w-3.5" /> : null}
          {saved ? "Update" : "Connect"}
        </Button>
      </div>
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
      {/* Says what the save actually DID. Changing this id rewrites the hoplink baked into every
          funnel's stored HTML, and that is the part worth confirming — "Connected" alone was what
          made a no-op look like a success. */}
      {justSaved && !error && (
        <p className="mt-2 text-xs text-emerald-300">
          Saved{rerendered > 0 ? ` — ${rerendered} funnel${rerendered === 1 ? "" : "s"} updated with the new link` : ""}.
        </p>
      )}
    </Card>
  );
}
