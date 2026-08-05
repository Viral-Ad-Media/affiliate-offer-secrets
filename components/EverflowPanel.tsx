"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Network, Loader2, CheckCircle2, Trash2, ExternalLink } from "lucide-react";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export type EverflowStatus = {
  connected: boolean;
  network_name: string | null;
  status: string;
  affiliate_id: string | null;
} | null;

// Settings → Integrations. Everflow is a platform many CPA networks run on, so one connection here
// reaches whichever of them the user has been approved by — every network on it requires manual
// affiliate approval, so the user brings their own key rather than signing up through us.
export default function EverflowPanel({ initial }: { initial: EverflowStatus }) {
  const router = useRouter();
  const [apiKey, setApiKey] = useState("");
  const [affiliateId, setAffiliateId] = useState(initial?.affiliate_id ?? "");
  const [networkName, setNetworkName] = useState(initial?.network_name ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function connect(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/everflow/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_key: apiKey, affiliate_id: affiliateId, network_name: networkName }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not connect");
      // The key is never echoed back and never re-rendered — clear it the moment it's stored.
      setApiKey("");
      toast.success(networkName ? `${networkName} connected` : "Everflow network connected");
      router.refresh();
    } catch (err: any) {
      setError(err?.message ?? String(err));
      toast.error(err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (!window.confirm("Disconnect this Everflow network? Your API key is deleted.")) return;
    setBusy(true);
    try {
      const res = await fetch("/api/everflow/disconnect", { method: "POST" });
      if (!res.ok) throw new Error("Could not disconnect");
      toast.success("Everflow disconnected");
      router.refresh();
    } catch (err: any) {
      toast.error(err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card as="section" className="space-y-4 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
            <Network className="h-4 w-4 text-emerald-400" /> Everflow networks
          </div>
          <p className="mt-1 text-xs text-zinc-500">
            Many CPA networks run on the Everflow platform — connecting your affiliate API key here
            reaches whichever one approved you. Each network approves affiliates manually, so use
            the key from your own partner portal (Security → API keys).
          </p>
        </div>
        {initial?.connected && (
          <Badge className="border-emerald-500/30 bg-emerald-500/15 text-emerald-300">
            <CheckCircle2 className="h-3 w-3" /> Connected
          </Badge>
        )}
      </div>

      {initial?.connected ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-ink-700 px-3 py-2">
          <div className="text-sm text-zinc-200">
            {initial.network_name || "Everflow network"}
            {initial.affiliate_id && (
              <span className="ml-2 text-xs text-zinc-500">affiliate {initial.affiliate_id}</span>
            )}
            {initial.status === "needs_reconnect" && (
              <span className="ml-2 text-xs text-red-300">key rejected — reconnect</span>
            )}
          </div>
          <Button onClick={disconnect} disabled={busy} variant="outline" className="text-xs">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            Disconnect
          </Button>
        </div>
      ) : null}

      <form onSubmit={connect} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-zinc-400">Network name (optional)</span>
            <input
              value={networkName}
              onChange={(e) => setNetworkName(e.target.value)}
              placeholder="e.g. MaxBounty, Advidi…"
              className="w-full rounded-lg border border-ink-600 bg-ink-900 py-2 px-3 text-sm outline-none placeholder:text-zinc-600 focus:border-emerald-500"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-zinc-400">Affiliate ID</span>
            <input
              value={affiliateId}
              onChange={(e) => setAffiliateId(e.target.value)}
              placeholder="12345"
              className="w-full rounded-lg border border-ink-600 bg-ink-900 py-2 px-3 font-mono text-sm outline-none placeholder:text-zinc-600 focus:border-emerald-500"
            />
          </label>
        </div>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-zinc-400">
            {initial?.connected ? "Replace API key" : "API key"}
          </span>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="Paste your Everflow affiliate API key"
            autoComplete="off"
            className="w-full rounded-lg border border-ink-600 bg-ink-900 py-2 px-3 font-mono text-sm outline-none placeholder:text-zinc-600 focus:border-emerald-500"
          />
          <span className="mt-1 block text-[12px] text-zinc-500">
            Checked against Everflow before it&apos;s saved, then encrypted — it&apos;s never shown
            again or sent back to your browser.
          </span>
        </label>

        {error && <p className="text-sm text-red-300">{error}</p>}

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={busy || !apiKey.trim()} className="text-xs">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            {initial?.connected ? "Update connection" : "Connect"}
          </Button>
          <a
            href="https://developers.everflow.io/docs/partner/api_keys/"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 text-xs text-zinc-500 underline hover:text-zinc-300"
          >
            Where do I find my key? <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </form>
    </Card>
  );
}
