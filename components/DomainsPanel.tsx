"use client";

import { useState } from "react";
import {
  Globe,
  Plus,
  Trash2,
  RefreshCw,
  Copy,
  CheckCircle2,
  Clock,
  XCircle,
  Loader2,
  ChevronDown,
  ChevronRight,
} from "lucide-react";

type DomainRoute = {
  id: string;
  path: string;
  destination: "presell" | "bridge";
  campaign_id: string;
};

type Domain = {
  id: string;
  domain: string;
  status: "pending" | "verified" | "error";
  error_message: string | null;
  created_at: string;
  custom_domain_routes: DomainRoute[];
};

type CampaignOption = { id: string; title: string };

const STATUS_STYLE: Record<Domain["status"], string> = {
  verified: "border-emerald-500/30 bg-emerald-500/15 text-emerald-300",
  pending: "border-amber-500/30 bg-amber-500/15 text-amber-300",
  error: "border-red-500/30 bg-red-500/15 text-red-300",
};

function AddRouteForm({
  domain,
  campaigns,
  onAdded,
}: {
  domain: Domain;
  campaigns: CampaignOption[];
  onAdded: (route: DomainRoute) => void;
}) {
  const [campaignId, setCampaignId] = useState(campaigns[0]?.id ?? "");
  const [destination, setDestination] = useState<"presell" | "bridge">("presell");
  const [path, setPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!campaignId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/domains/${domain.id}/routes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaign_id: campaignId, destination, path }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to add route");
      onAdded({ id: data.id, path: path.replace(/^\/+|\/+$/g, "").toLowerCase(), destination, campaign_id: campaignId });
      setPath("");
    } catch (err: any) {
      setError(err?.message ?? "Failed to add route");
    } finally {
      setBusy(false);
    }
  }

  if (campaigns.length === 0) {
    return (
      <p className="text-xs text-zinc-500">
        No ready campaigns yet — build a campaign kit first, then map it to a path here.
      </p>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        value={campaignId}
        onChange={(e) => setCampaignId(e.target.value)}
        className="rounded-lg border border-ink-600 bg-ink-800 px-2 py-1.5 text-xs text-zinc-100"
      >
        {campaigns.map((c) => (
          <option key={c.id} value={c.id}>
            {c.title}
          </option>
        ))}
      </select>
      <select
        value={destination}
        onChange={(e) => setDestination(e.target.value as "presell" | "bridge")}
        className="rounded-lg border border-ink-600 bg-ink-800 px-2 py-1.5 text-xs text-zinc-100"
      >
        <option value="presell">Presell</option>
        <option value="bridge">Bridge</option>
      </select>
      <div className="flex items-center gap-1 text-xs text-zinc-500">
        <span>/{domain.domain}/</span>
        <input
          value={path}
          onChange={(e) => setPath(e.target.value)}
          placeholder="path (blank = root)"
          className="w-40 rounded-lg border border-ink-600 bg-ink-800 px-2 py-1.5 text-xs text-zinc-100"
        />
      </div>
      <button onClick={submit} disabled={busy} className="btn-ghost !py-1 text-xs">
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
        Add path
      </button>
      {error && <span className="text-xs text-red-300">{error}</span>}
    </div>
  );
}

function DomainRow({
  domain,
  campaigns,
  onUpdate,
  onRemove,
}: {
  domain: Domain;
  campaigns: CampaignOption[];
  onUpdate: (d: Domain) => void;
  onRemove: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  async function verify() {
    setVerifying(true);
    try {
      const res = await fetch(`/api/domains/${domain.id}/verify`, { method: "POST" });
      const data = await res.json();
      if (res.ok) onUpdate({ ...domain, ...data.domain });
    } finally {
      setVerifying(false);
    }
  }

  async function remove() {
    if (!confirm(`Remove ${domain.domain}? This deletes all its path mappings too.`)) return;
    setRemoving(true);
    try {
      const res = await fetch(`/api/domains/${domain.id}`, { method: "DELETE" });
      if (res.ok) onRemove(domain.id);
    } finally {
      setRemoving(false);
    }
  }

  async function removeRoute(routeId: string) {
    const res = await fetch(`/api/domains/${domain.id}/routes/${routeId}`, { method: "DELETE" });
    if (res.ok) {
      onUpdate({
        ...domain,
        custom_domain_routes: domain.custom_domain_routes.filter((r) => r.id !== routeId),
      });
    }
  }

  function copyUrl(id: string, url: string) {
    navigator.clipboard.writeText(url);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between px-4 py-3">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-2 text-sm text-zinc-100"
        >
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          <Globe className="h-4 w-4 text-zinc-500" />
          {domain.domain}
        </button>
        <div className="flex items-center gap-2">
          <span className={`chip ${STATUS_STYLE[domain.status]}`}>
            {domain.status === "verified" && <CheckCircle2 className="h-3 w-3" />}
            {domain.status === "pending" && <Clock className="h-3 w-3" />}
            {domain.status === "error" && <XCircle className="h-3 w-3" />}
            {domain.status}
          </span>
          {domain.status !== "verified" && (
            <button onClick={verify} disabled={verifying} className="btn-ghost !py-1 text-xs">
              {verifying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Verify
            </button>
          )}
          <button
            onClick={remove}
            disabled={removing}
            className="rounded-lg p-1.5 text-zinc-500 hover:bg-ink-800 hover:text-red-300"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="space-y-3 border-t border-ink-700 px-4 py-3">
          {domain.status !== "verified" && (
            <div className="rounded-lg bg-ink-800 p-3 text-xs text-zinc-400">
              Point your domain's DNS at Vercel, then click Verify: an{" "}
              <code className="text-emerald-300">A</code> record to{" "}
              <code className="text-emerald-300">76.76.21.21</code> (apex domain), or a{" "}
              <code className="text-emerald-300">CNAME</code> to{" "}
              <code className="text-emerald-300">cname.vercel-dns.com</code> (subdomain).
              {domain.error_message && (
                <p className="mt-1 text-red-300">{domain.error_message}</p>
              )}
            </div>
          )}

          <div className="space-y-1.5">
            {domain.custom_domain_routes.length === 0 && (
              <p className="text-xs text-zinc-500">No paths mapped yet.</p>
            )}
            {domain.custom_domain_routes.map((r) => {
              const url = `https://${domain.domain}/${r.path}`;
              return (
                <div
                  key={r.id}
                  className="flex items-center justify-between rounded-lg border border-ink-700 px-3 py-2 text-xs"
                >
                  <div className="flex items-center gap-2 text-zinc-300">
                    <span className="chip border-ink-600 bg-ink-800 text-zinc-400">
                      {r.destination}
                    </span>
                    <span className="truncate">{url}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => copyUrl(r.id, url)}
                      className="rounded p-1 text-zinc-500 hover:text-zinc-200"
                    >
                      {copiedId === r.id ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </button>
                    <button
                      onClick={() => removeRoute(r.id)}
                      className="rounded p-1 text-zinc-500 hover:text-red-300"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <AddRouteForm
            domain={domain}
            campaigns={campaigns}
            onAdded={(route) =>
              onUpdate({ ...domain, custom_domain_routes: [...domain.custom_domain_routes, route] })
            }
          />
        </div>
      )}
    </div>
  );
}

export default function DomainsPanel({
  initialDomains,
  campaigns,
}: {
  initialDomains: Domain[];
  campaigns: CampaignOption[];
}) {
  const [domains, setDomains] = useState<Domain[]>(initialDomains);
  const [newDomain, setNewDomain] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function addDomain() {
    if (!newDomain.trim()) return;
    setAdding(true);
    setError(null);
    try {
      const res = await fetch("/api/domains", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain: newDomain.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to add domain");
      setDomains((d) => [{ ...data.domain, custom_domain_routes: [] }, ...d]);
      setNewDomain("");
    } catch (err: any) {
      setError(err?.message ?? "Failed to add domain");
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={newDomain}
            onChange={(e) => setNewDomain(e.target.value)}
            placeholder="yourdomain.com"
            className="min-w-[220px] flex-1 rounded-lg border border-ink-600 bg-ink-800 px-3 py-2 text-sm text-zinc-100"
          />
          <button onClick={addDomain} disabled={adding} className="btn-primary">
            {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Add domain
          </button>
        </div>
        {error && <p className="mt-2 text-sm text-red-300">{error}</p>}
      </div>

      {domains.length === 0 ? (
        <p className="text-sm text-zinc-500">No domains connected yet.</p>
      ) : (
        <div className="space-y-3">
          {domains.map((d) => (
            <DomainRow
              key={d.id}
              domain={d}
              campaigns={campaigns}
              onUpdate={(updated) => setDomains((ds) => ds.map((x) => (x.id === updated.id ? updated : x)))}
              onRemove={(id) => setDomains((ds) => ds.filter((x) => x.id !== id))}
            />
          ))}
        </div>
      )}
    </div>
  );
}
