"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, Megaphone, Sparkles } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type AdAccount = { ad_account_id: string; ad_account_name: string; currency: string; is_active: boolean };
type PageInfo = { page_id: string; page_name: string; is_active: boolean; status: string };
type LaunchRow = {
  status: "building" | "paused_review" | "activating" | "active" | "failed";
  budget_credits: number;
  notes: string | null;
} | null;

export default function LaunchAd({
  campaignId,
  defaultHeadline,
  defaultPrimaryText,
  bridgePublished,
}: {
  campaignId: string;
  defaultHeadline: string;
  defaultPrimaryText: string;
  bridgePublished: boolean;
}) {
  const [loading, setLoading] = useState(true);
  const [adsGranted, setAdsGranted] = useState(false);
  const [adAccount, setAdAccount] = useState<AdAccount | null>(null);
  const [page, setPage] = useState<PageInfo | null>(null);
  const [headline, setHeadline] = useState(defaultHeadline);
  const [primaryText, setPrimaryText] = useState(defaultPrimaryText);
  const [budget, setBudget] = useState(10);
  const [country, setCountry] = useState("US");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [launch, setLaunch] = useState<LaunchRow>(null);
  const [adCreative, setAdCreative] = useState<string | null>(null);
  const [generatingCreative, setGeneratingCreative] = useState(false);

  async function loadAdCreative() {
    const { data } = await createClient()
      .from("campaigns")
      .select("ad_creative_image_data_url")
      .eq("id", campaignId)
      .maybeSingle();
    setAdCreative((data as any)?.ad_creative_image_data_url ?? null);
  }

  async function generateAdCreative() {
    setGeneratingCreative(true);
    setError(null);
    const res = await fetch(`/api/campaigns/${campaignId}/generate-ad-image`, { method: "POST" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Failed to start generation");
      setGeneratingCreative(false);
      return;
    }
    // Generation runs async via the job queue — poll for the result.
    const start = Date.now();
    const poll = setInterval(async () => {
      const { data } = await createClient()
        .from("campaigns")
        .select("ad_creative_image_data_url")
        .eq("id", campaignId)
        .maybeSingle();
      const url = (data as any)?.ad_creative_image_data_url ?? null;
      if (url) setAdCreative(url);
      if (url || Date.now() - start > 90_000) {
        clearInterval(poll);
        setGeneratingCreative(false);
        if (!url) setError("Still generating — check back in a moment");
      }
    }, 3000);
  }

  async function loadLaunch() {
    const { data } = await createClient()
      .from("ad_launches")
      .select("status, budget_credits, notes")
      .eq("campaign_id", campaignId)
      .maybeSingle();
    setLaunch(data as LaunchRow);
  }

  useEffect(() => {
    const supabase = createClient();
    Promise.all([supabase.rpc("get_meta_connection_status"), loadLaunch(), loadAdCreative()]).then(([{ data }]: any[]) => {
      setAdsGranted(!!data?.ads_management_granted);
      const accounts = (data?.ad_accounts ?? []) as AdAccount[];
      setAdAccount(accounts.find((a) => a.is_active) ?? accounts[0] ?? null);
      const pages = (data?.pages ?? []) as PageInfo[];
      setPage(pages.find((p) => p.is_active && p.status === "connected") ?? null);
      setLoading(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId]);

  useEffect(() => {
    if (launch?.status !== "building" && launch?.status !== "activating") return;
    const t = setInterval(loadLaunch, 3000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [launch?.status]);

  async function createDraft() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/meta/ads/create", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        campaign_id: campaignId,
        ad_account_id: adAccount!.ad_account_id,
        page_id: page!.page_id,
        headline,
        primary_text: primaryText,
        country,
        budget_credits: budget,
      }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "Failed to queue launch");
      return;
    }
    setLaunch({ status: "building", budget_credits: budget, notes: null });
  }

  async function activate() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/meta/ads/activate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ campaign_id: campaignId }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) setError(data.error ?? "Failed to activate");
    await loadLaunch();
  }

  if (loading) return null;

  if (!adsGranted) {
    return (
      <div className="rounded-lg border border-ink-700 bg-ink-800/50 p-4 text-sm text-zinc-400">
        Connect Facebook with ad permissions in{" "}
        <a href="/connections" className="text-emerald-400 underline">
          Connections
        </a>{" "}
        to launch real ad campaigns.
      </div>
    );
  }
  if (!adAccount || !page) {
    return (
      <div className="rounded-lg border border-ink-700 bg-ink-800/50 p-4 text-sm text-zinc-400">
        Connect a Facebook Page and ad account in{" "}
        <a href="/connections" className="text-emerald-400 underline">
          Connections
        </a>{" "}
        to launch real ad campaigns.
      </div>
    );
  }
  if (!bridgePublished && !launch) {
    return (
      <div className="rounded-lg border border-ink-700 bg-ink-800/50 p-4 text-sm text-zinc-400">
        Publish your bridge page (on the Bridge page tab) before launching an ad — otherwise
        traffic would land on a page nobody can see yet.
      </div>
    );
  }

  const previewUrl =
    typeof window !== "undefined" ? `${process.env.NEXT_PUBLIC_APP_URL}/p/${campaignId}/bridge` : "";

  if (launch?.status === "building") {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-sky-500/30 bg-sky-500/10 px-4 py-3 text-sm text-sky-300">
        <Loader2 className="h-4 w-4 animate-spin" /> Building your ad draft on Meta (paused,
        nothing spends yet)…
      </div>
    );
  }
  if (launch?.status === "activating") {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-sky-500/30 bg-sky-500/10 px-4 py-3 text-sm text-sky-300">
        <Loader2 className="h-4 w-4 animate-spin" /> Activating…
      </div>
    );
  }
  if (launch?.status === "active") {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
        <CheckCircle2 className="h-4 w-4" /> Live on Meta — {launch.budget_credits} credits/day
        authorized.
      </div>
    );
  }
  if (launch?.status === "paused_review") {
    return (
      <div className="rounded-lg border border-ink-700 p-4">
        <div className="mb-2 text-sm text-zinc-100">Draft ready — paused, review before going live</div>
        <div className="mb-3 space-y-1 text-xs text-zinc-400">
          <div>Budget: {launch.budget_credits} credits/day (≈ ${launch.budget_credits}/day)</div>
          <div>Ad account: {adAccount.ad_account_name}</div>
          <div>Page: {page.page_name}</div>
          <div>
            Links to:{" "}
            <a href={previewUrl} target="_blank" rel="noreferrer" className="text-emerald-400 underline">
              {previewUrl}
            </a>
          </div>
        </div>
        <button onClick={activate} disabled={busy} className="btn-primary">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Megaphone className="h-4 w-4" />}
          Activate — spend {launch.budget_credits} credits
        </button>
        {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
      </div>
    );
  }
  if (launch?.status === "failed") {
    return (
      <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4">
        <p className="mb-2 text-sm text-red-300">Launch failed: {launch.notes ?? "Unknown error"}</p>
        <p className="mb-3 text-xs text-zinc-500">Any reserved credits were refunded automatically.</p>
        <button onClick={createDraft} disabled={busy} className="btn-ghost">
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-ink-700 p-4">
      <div className="mb-2 flex items-center gap-2 text-xs text-zinc-500">
        <Megaphone className="h-3.5 w-3.5" /> Launch on {adAccount.ad_account_name} → {page.page_name}
        — paused until you confirm
      </div>
      <label className="mb-1 block text-xs font-medium text-zinc-400">Headline</label>
      <input
        value={headline}
        onChange={(e) => setHeadline(e.target.value)}
        className="mb-2 w-full rounded-lg border border-ink-600 bg-ink-900 px-3 py-2 text-sm outline-none focus:border-emerald-500"
      />
      <div className="mb-3">
        <label className="mb-1 block text-xs font-medium text-zinc-400">Ad creative image</label>
        {adCreative ? (
          <div className="flex items-center gap-3">
            <img src={adCreative} alt="Ad creative" className="h-16 w-16 rounded-lg border border-ink-700 object-cover" />
            <button onClick={generateAdCreative} disabled={generatingCreative} className="btn-ghost !py-1.5 text-xs">
              {generatingCreative ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              Regenerate
            </button>
          </div>
        ) : (
          <button onClick={generateAdCreative} disabled={generatingCreative} className="btn-ghost text-xs">
            {generatingCreative ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            {generatingCreative ? "Generating…" : "Generate ad creative"}
          </button>
        )}
        {!adCreative && !generatingCreative && (
          <p className="mt-1 text-xs text-zinc-500">
            Optional — falls back to the product photo from the vendor's sales page if skipped.
          </p>
        )}
      </div>
      <label className="mb-1 block text-xs font-medium text-zinc-400">Primary text</label>
      <textarea
        value={primaryText}
        onChange={(e) => setPrimaryText(e.target.value)}
        rows={3}
        className="mb-2 w-full rounded-lg border border-ink-600 bg-ink-900 p-3 text-sm outline-none focus:border-emerald-500"
      />
      <div className="mb-3 flex items-center gap-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-zinc-400">Daily budget (credits)</label>
          <input
            type="number"
            min={1}
            value={budget}
            onChange={(e) => setBudget(Number(e.target.value) || 1)}
            className="w-28 rounded-lg border border-ink-600 bg-ink-900 px-3 py-2 text-sm outline-none focus:border-emerald-500"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-zinc-400">Country</label>
          <input
            value={country}
            onChange={(e) => setCountry(e.target.value.toUpperCase())}
            maxLength={2}
            className="w-20 rounded-lg border border-ink-600 bg-ink-900 px-3 py-2 text-sm outline-none focus:border-emerald-500"
          />
        </div>
      </div>
      <button
        onClick={createDraft}
        disabled={busy || !headline.trim() || !primaryText.trim()}
        className="btn-primary"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Megaphone className="h-4 w-4" />}
        Create paused draft
      </button>
      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
    </div>
  );
}
