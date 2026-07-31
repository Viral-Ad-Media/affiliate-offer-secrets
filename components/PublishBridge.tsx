"use client";

import { useEffect, useState } from "react";
import { Globe, Copy, CheckCircle2, Loader2, Plus, Trash2, Radio } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type Domain = { id: string; domain: string };
type Route = { id: string; domain_id: string; domain: string; path: string };

export default function PublishBridge({
  campaignId,
  initialPublished,
}: {
  campaignId: string;
  initialPublished: boolean;
}) {
  const [published, setPublished] = useState(initialPublished);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [domains, setDomains] = useState<Domain[]>([]);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [selectedDomainId, setSelectedDomainId] = useState("");
  const [path, setPath] = useState("");
  const [addingRoute, setAddingRoute] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);

  const defaultUrl =
    typeof window !== "undefined" ? `${process.env.NEXT_PUBLIC_APP_URL}/p/${campaignId}/bridge` : "";

  useEffect(() => {
    const supabase = createClient();
    Promise.all([
      supabase.from("custom_domains").select("id, domain").eq("status", "verified"),
      supabase
        .from("custom_domain_routes")
        .select("id, domain_id, path, custom_domains(domain)")
        .eq("campaign_id", campaignId),
    ]).then(([{ data: domainRows }, { data: routeRows }]) => {
      setDomains((domainRows ?? []) as Domain[]);
      setSelectedDomainId((domainRows ?? [])[0]?.id ?? "");
      setRoutes(
        ((routeRows ?? []) as any[]).map((r) => ({
          id: r.id,
          domain_id: r.domain_id,
          path: r.path,
          domain: r.custom_domains?.domain ?? "",
        }))
      );
    });
  }, [campaignId]);

  async function togglePublish() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/campaigns/${campaignId}/publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ published: !published }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "Failed to update");
      return;
    }
    setPublished(data.published);
  }

  function copyLink() {
    navigator.clipboard.writeText(defaultUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function addRoute() {
    if (!selectedDomainId) return;
    setAddingRoute(true);
    setRouteError(null);
    try {
      const res = await fetch(`/api/domains/${selectedDomainId}/routes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaign_id: campaignId, path }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to add link");
      const domain = domains.find((d) => d.id === selectedDomainId);
      setRoutes((r) => [
        ...r,
        { id: data.id, domain_id: selectedDomainId, path: path.replace(/^\/+|\/+$/g, "").toLowerCase(), domain: domain?.domain ?? "" },
      ]);
      setPath("");
    } catch (err: any) {
      setRouteError(err?.message ?? "Failed to add link");
    } finally {
      setAddingRoute(false);
    }
  }

  async function removeRoute(routeId: string, domainId: string) {
    const res = await fetch(`/api/domains/${domainId}/routes/${routeId}`, { method: "DELETE" });
    if (res.ok) setRoutes((r) => r.filter((x) => x.id !== routeId));
  }

  return (
    <div className="mb-3 rounded-lg border border-ink-700 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className={`chip ${
              published
                ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-300"
                : "border-ink-600 bg-ink-800 text-zinc-400"
            }`}
          >
            <Radio className="h-3 w-3" /> {published ? "Published" : "Draft"}
          </span>
          {!published && (
            <span className="text-xs text-zinc-500">Not publicly reachable until published.</span>
          )}
        </div>
        <button onClick={togglePublish} disabled={busy} className={published ? "btn-ghost" : "btn-primary"}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {published ? "Unpublish" : "Publish"}
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-red-300">{error}</p>}

      {published && (
        <div className="mt-3 space-y-3">
          <div className="flex items-center justify-between gap-2 rounded-lg border border-ink-700 bg-ink-800 px-3 py-2 text-xs">
            <span className="truncate text-zinc-300">{defaultUrl}</span>
            <button onClick={copyLink} className="rounded p-1 text-zinc-500 hover:text-zinc-200">
              {copied ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
            </button>
          </div>

          <div>
            <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-500">
              <Globe className="h-3 w-3" /> Custom domain links
            </div>
            <div className="space-y-1.5">
              {routes.map((r) => {
                const url = `https://${r.domain}/${r.path}`;
                return (
                  <div
                    key={r.id}
                    className="flex items-center justify-between rounded-lg border border-ink-700 px-3 py-1.5 text-xs"
                  >
                    <span className="truncate text-zinc-300">{url}</span>
                    <button
                      onClick={() => removeRoute(r.id, r.domain_id)}
                      className="rounded p-1 text-zinc-500 hover:text-red-300"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
            {domains.length === 0 ? (
              <p className="mt-1.5 text-xs text-zinc-500">
                No connected domains yet —{" "}
                <a href="/settings/domains" className="underline">
                  connect one
                </a>{" "}
                for a branded link, or just use the default link above.
              </p>
            ) : (
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <select
                  value={selectedDomainId}
                  onChange={(e) => setSelectedDomainId(e.target.value)}
                  className="rounded-lg border border-ink-600 bg-ink-800 px-2 py-1.5 text-xs text-zinc-100"
                >
                  {domains.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.domain}
                    </option>
                  ))}
                </select>
                <input
                  value={path}
                  onChange={(e) => setPath(e.target.value)}
                  placeholder="path (blank = root)"
                  className="w-40 rounded-lg border border-ink-600 bg-ink-800 px-2 py-1.5 text-xs text-zinc-100"
                />
                <button onClick={addRoute} disabled={addingRoute} className="btn-ghost !py-1 text-xs">
                  {addingRoute ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                  Add link
                </button>
                {routeError && <span className="text-xs text-red-300">{routeError}</span>}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
