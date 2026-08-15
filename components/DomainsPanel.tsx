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
  Star,
  BookOpen,
} from "lucide-react";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { NETLIFY_DNS_A_RECORD, netlifyCnameTarget } from "@/lib/netlify/dns";
import { Badge } from "@/components/ui/badge";
import EmptyState from "@/components/EmptyState";

type DomainRoute = {
  id: string;
  path: string;
  campaign_id: string;
};

type Domain = {
  id: string;
  domain: string;
  status: "pending" | "verified" | "error";
  error_message: string | null;
  created_at: string;
  // One-per-tenant role flags (0042). serves_blog is honored by app/d/[[...path]]/route.ts;
  // is_primary is the origin the app shows as this tenant's public home.
  serves_blog: boolean;
  is_primary: boolean;
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
        body: JSON.stringify({ campaign_id: campaignId, path }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to add route");
      onAdded({ id: data.id, path: path.replace(/^\/+|\/+$/g, "").toLowerCase(), campaign_id: campaignId });
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
      <div className="flex items-center gap-1 text-xs text-zinc-500">
        <span>/{domain.domain}/</span>
        <input
          value={path}
          onChange={(e) => setPath(e.target.value)}
          placeholder="path (blank = root)"
          className="w-40 rounded-lg border border-ink-600 bg-ink-800 px-2 py-1.5 text-xs text-zinc-100"
        />
      </div>
      <Button onClick={submit} disabled={busy} variant="outline" className="!py-1 text-xs">
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
        Add path
      </Button>
      {error && <span className="text-xs text-red-300">{error}</span>}
    </div>
  );
}

// The DNS records the registrar actually needs, as a real record table instead of a sentence.
// Which record applies depends on whether this is an apex domain or a subdomain, so only the one
// that applies is shown as required — guessing wrong is the single most common reason a domain
// sits at "pending".
//
// The label counts dots, which is right for example.com and blog.example.com and wrong for a
// two-part public suffix like example.co.uk (it reads as a subdomain). Both records are listed
// either way and whichever is correct is the one that resolves, so the mislabel costs a reader a
// moment, not a failed setup.
//
// The values come from lib/netlify/dns.ts rather than being typed here. They were literals, while
// the API client exported its own copies that nothing imported — so the pair could drift, and a
// tenant following a stale record would just watch their domain never verify.
function DnsSetup({
  domain,
  verifying,
  onVerify,
  copiedId,
  onCopy,
}: {
  domain: Domain;
  verifying: boolean;
  onVerify: () => void;
  copiedId: string | null;
  onCopy: (id: string, value: string) => void;
}) {
  const labels = domain.domain.split(".");
  const isApex = labels.length <= 2;
  const subdomain = isApex ? "@" : labels.slice(0, -2).join(".");

  const records = [
    {
      id: `${domain.id}-a`,
      type: "A",
      name: "@",
      value: NETLIFY_DNS_A_RECORD,
      applies: isApex,
      note: "apex domain (example.com)",
    },
    {
      id: `${domain.id}-cname`,
      type: "CNAME",
      name: subdomain === "@" ? "www" : subdomain,
      value: netlifyCnameTarget(),
      applies: !isApex,
      note: "subdomain (blog.example.com)",
    },
  ];

  return (
    <div className="space-y-2 rounded-lg border border-ink-700 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium text-zinc-300">DNS records</p>
        <Button onClick={onVerify} disabled={verifying} variant="outline" className="!py-1 text-xs">
          {verifying ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          {domain.status === "verified" ? "Re-check DNS" : "Verify DNS"}
        </Button>
      </div>

      <p className="text-xs text-zinc-500">
        {domain.status === "verified"
          ? "Pointing at us correctly. Keep these records in place — if they change, this domain stops serving."
          : "Add this record at your registrar, then click Verify. DNS changes can take a few minutes to propagate."}
      </p>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] text-left text-xs">
          <thead className="text-zinc-500">
            <tr>
              <th className="py-1 pr-3 font-medium">Type</th>
              <th className="py-1 pr-3 font-medium">Name</th>
              <th className="py-1 pr-3 font-medium">Value</th>
              <th className="py-1 font-medium">&nbsp;</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-800">
            {records.map((r) => (
              <tr key={r.id} className={r.applies ? "text-zinc-200" : "text-zinc-600"}>
                <td className="py-1.5 pr-3 font-mono">{r.type}</td>
                <td className="py-1.5 pr-3 font-mono">{r.name}</td>
                <td className="py-1.5 pr-3 font-mono">{r.value}</td>
                <td className="py-1.5">
                  {r.applies ? (
                    <button
                      onClick={() => onCopy(r.id, r.value)}
                      title="Copy value"
                      className="text-zinc-500 hover:text-zinc-200"
                    >
                      {copiedId === r.id ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </button>
                  ) : (
                    <span className="text-[12px]">for a {r.note}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {domain.error_message && <p className="text-xs text-red-300">{domain.error_message}</p>}
    </div>
  );
}

function DomainRow({
  domain,
  campaigns,
  onUpdate,
  onRemove,
  onFlagChange,
}: {
  domain: Domain;
  campaigns: CampaignOption[];
  onUpdate: (d: Domain) => void;
  onRemove: (id: string) => void;
  onFlagChange: (id: string, flag: "serves_blog" | "is_primary", value: boolean) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [flagBusy, setFlagBusy] = useState<null | "serves_blog" | "is_primary">(null);
  const [flagError, setFlagError] = useState<string | null>(null);

  // Both flags are one-per-tenant, so a change here affects other rows too — refresh the whole
  // list rather than patching this row's local copy.
  async function setFlag(flag: "serves_blog" | "is_primary", value: boolean) {
    setFlagBusy(flag);
    setFlagError(null);
    try {
      const res = await fetch(`/api/domains/${domain.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [flag]: value }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFlagError(data.error ?? "Could not update this domain");
        toast.error(data.error ?? "Could not update this domain");
      } else {
        onFlagChange(domain.id, flag, value);
        const what = flag === "serves_blog" ? "blog" : "primary domain";
        toast.success(
          value ? `${domain.domain} is now your ${what}` : `${domain.domain} is no longer your ${what}`
        );
      }
    } catch (err: any) {
      setFlagError(err?.message ?? String(err));
    } finally {
      setFlagBusy(null);
    }
  }

  async function verify() {
    setVerifying(true);
    try {
      const res = await fetch(`/api/domains/${domain.id}/verify`, { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        onUpdate({ ...domain, ...data.domain });
        toast[data.domain?.status === "verified" ? "success" : "info"](
          data.domain?.status === "verified"
            ? `${domain.domain} is verified`
            : `${domain.domain} isn't pointing here yet — DNS can take a few minutes`
        );
      } else {
        toast.error(data.error ?? "Could not check this domain");
      }
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
    <Card>
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
          <Badge className={STATUS_STYLE[domain.status]}>
            {domain.status === "verified" && <CheckCircle2 className="h-3 w-3" />}
            {domain.status === "pending" && <Clock className="h-3 w-3" />}
            {domain.status === "error" && <XCircle className="h-3 w-3" />}
            {domain.status}
          </Badge>
          {domain.is_primary && (
            <Badge className="border-emerald-500/30 bg-emerald-500/15 text-emerald-300">
              <Star className="h-3 w-3" /> Primary
            </Badge>
          )}
          {domain.serves_blog && (
            <Badge className="border-sky-500/30 bg-sky-500/15 text-sky-300">
              <BookOpen className="h-3 w-3" /> Blog
            </Badge>
          )}
          <Button onClick={verify} disabled={verifying} variant="outline" className="!py-1 text-xs">
            {verifying ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            {domain.status === "verified" ? "Re-check" : "Verify"}
          </Button>
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
          <DnsSetup
            domain={domain}
            verifying={verifying}
            onVerify={verify}
            copiedId={copiedId}
            onCopy={copyUrl}
          />

          {domain.status === "verified" && (
            <div className="space-y-2 rounded-lg border border-ink-700 p-3">
              <p className="text-xs font-medium text-zinc-300">What this domain is used for</p>
              <label className="flex items-start gap-2 text-xs text-zinc-400">
                <input
                  type="checkbox"
                  checked={domain.serves_blog}
                  disabled={flagBusy !== null}
                  onChange={(e) => setFlag("serves_blog", e.target.checked)}
                  className="mt-0.5 accent-emerald-500"
                />
                <span>
                  <span className="text-zinc-200">Publish my blog here</span> — the blog index and
                  every post are served at this domain&apos;s root. Paths mapped below still win,
                  so this domain can host funnel pages too. Only one domain at a time.
                </span>
              </label>
              <label className="flex items-start gap-2 text-xs text-zinc-400">
                <input
                  type="checkbox"
                  checked={domain.is_primary}
                  disabled={flagBusy !== null}
                  onChange={(e) => setFlag("is_primary", e.target.checked)}
                  className="mt-0.5 accent-emerald-500"
                />
                <span>
                  <span className="text-zinc-200">Primary domain</span> — the address the app shows
                  as your public home when you have more than one. Doesn&apos;t change what any URL
                  resolves to; every connected domain keeps working. Only one domain at a time.
                </span>
              </label>
              {/* Says WHY the boxes are already ticked on a first domain. The trigger (0078) only
                  ever fills a role nothing else holds, so this note is never shown as an excuse for
                  overriding a choice — switching below always wins. */}
              <p className="text-[11px] leading-snug text-zinc-500">
                Your first verified domain takes both roles automatically. Tick another domain to
                move either one — that choice is kept.
              </p>
              {flagBusy && (
                <p className="flex items-center gap-1 text-xs text-zinc-500">
                  <Loader2 className="h-3 w-3 animate-spin" /> Saving…
                </p>
              )}
              {flagError && <p className="text-xs text-red-300">{flagError}</p>}
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
    </Card>
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

  // serves_blog and is_primary are one-per-tenant (partial unique indexes, 0042) and the PATCH
  // route clears the flag on every other domain before setting it here — mirror that locally so
  // the other rows' badges update in the same tick.
  function applyFlag(id: string, flag: "serves_blog" | "is_primary", value: boolean) {
    setDomains((ds) =>
      ds.map((d) => (d.id === id ? { ...d, [flag]: value } : value ? { ...d, [flag]: false } : d))
    );
  }

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
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={newDomain}
            onChange={(e) => setNewDomain(e.target.value)}
            placeholder="yourdomain.com"
            className="min-w-[220px] flex-1 rounded-lg border border-ink-600 bg-ink-800 px-3 py-2 text-sm text-zinc-100"
          />
          <Button onClick={addDomain} disabled={adding}>
            {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Add domain
          </Button>
        </div>
        {error && <p className="mt-2 text-sm text-red-300">{error}</p>}
      </Card>

      {domains.length === 0 ? (
        <EmptyState icon={Globe} title="No domains connected yet" compact>
          Funnels and blog posts are already reachable on your own subdomain — a custom domain is
          for serving them under a brand you own. Add one above, then point its DNS at the records
          shown.
        </EmptyState>
      ) : (
        <div className="space-y-3">
          {domains.map((d) => (
            <DomainRow
              key={d.id}
              domain={d}
              campaigns={campaigns}
              onUpdate={(updated) => setDomains((ds) => ds.map((x) => (x.id === updated.id ? updated : x)))}
              onRemove={(id) => setDomains((ds) => ds.filter((x) => x.id !== id))}
              onFlagChange={applyFlag}
            />
          ))}
        </div>
      )}
    </div>
  );
}
