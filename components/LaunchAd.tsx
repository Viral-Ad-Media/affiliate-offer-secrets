"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, Megaphone } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { AdLaunch, CreativeKind } from "@/lib/shared";
import { Button } from "@/components/ui/button";

type AdAccount = { ad_account_id: string; ad_account_name: string; currency: string; is_active: boolean };
type PageInfo = { page_id: string; page_name: string; is_active: boolean; status: string };
type LaunchRow = Pick<AdLaunch, "id" | "creative_kind" | "status" | "budget_credits" | "notes"> | null;

// Per-angle launch UI (Phase J) — one instance per ad angle, mounted inside AdAnglesPanel.tsx.
// Launches that angle's own copy + its own generated creative (image or video), picked from
// campaign_creatives, instead of a single global campaign-level creative.
export default function LaunchAd({
  campaignId,
  angleIndex,
  defaultHeadline,
  defaultPrimaryText,
  bridgePublished,
}: {
  campaignId: string;
  angleIndex: number;
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
  const [readyKinds, setReadyKinds] = useState<Record<CreativeKind, boolean>>({ image: false, video: false });

  async function loadLaunch() {
    const { data } = await createClient()
      .from("ad_launches")
      .select("id, creative_kind, status, budget_credits, notes")
      .eq("campaign_id", campaignId)
      .eq("angle_index", angleIndex)
      .maybeSingle();
    setLaunch(data as LaunchRow);
  }

  async function loadReadyKinds() {
    const { data } = await createClient()
      .from("campaign_creatives")
      .select("kind, status")
      .eq("campaign_id", campaignId)
      .eq("source", "fb_ad_angle")
      .eq("item_index", angleIndex);
    const rows = (data ?? []) as { kind: CreativeKind; status: string }[];
    setReadyKinds({
      image: rows.some((r) => r.kind === "image" && r.status === "ready"),
      video: rows.some((r) => r.kind === "video" && r.status === "ready"),
    });
  }

  useEffect(() => {
    const supabase = createClient();
    Promise.all([supabase.rpc("get_meta_connection_status"), loadLaunch(), loadReadyKinds()]).then(
      ([{ data }]: any[]) => {
        setAdsGranted(!!data?.ads_management_granted);
        const accounts = (data?.ad_accounts ?? []) as AdAccount[];
        setAdAccount(accounts.find((a) => a.is_active) ?? accounts[0] ?? null);
        const pages = (data?.pages ?? []) as PageInfo[];
        setPage(pages.find((p) => p.is_active && p.status === "connected") ?? null);
        setLoading(false);
      }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId, angleIndex]);

  useEffect(() => {
    if (launch?.status !== "building" && launch?.status !== "activating") return;
    const t = setInterval(loadLaunch, 3000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [launch?.status]);

  async function createDraft(kind: CreativeKind) {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/meta/ads/create", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        campaign_id: campaignId,
        ad_account_id: adAccount!.ad_account_id,
        page_id: page!.page_id,
        angle_index: angleIndex,
        creative_kind: kind,
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
    setLaunch({ id: "", creative_kind: kind, status: "building", budget_credits: budget, notes: null });
    await loadLaunch();
  }

  async function activate() {
    if (!launch?.id) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/meta/ads/activate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ launch_id: launch.id }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) setError(data.error ?? "Failed to activate");
    await loadLaunch();
  }

  if (loading) return null;

  if (!adsGranted) {
    return (
      <div className="mt-2 rounded-lg border border-ink-700 bg-ink-800/50 p-3 text-xs text-zinc-400">
        Connect Facebook with ad permissions in{" "}
        <a href="/settings/integrations" className="text-emerald-400 underline">
          Integrations
        </a>{" "}
        to launch this angle as a real ad.
      </div>
    );
  }
  if (!adAccount || !page) {
    return (
      <div className="mt-2 rounded-lg border border-ink-700 bg-ink-800/50 p-3 text-xs text-zinc-400">
        Connect a Facebook Page and ad account in{" "}
        <a href="/settings/integrations" className="text-emerald-400 underline">
          Integrations
        </a>{" "}
        to launch this angle as a real ad.
      </div>
    );
  }
  if (!bridgePublished && !launch) {
    return (
      <div className="mt-2 rounded-lg border border-ink-700 bg-ink-800/50 p-3 text-xs text-zinc-400">
        Publish your bridge page before launching an ad — otherwise traffic would land on a page
        nobody can see yet.
      </div>
    );
  }

  // Preview on the host you're on (see PublishBridge). The ACTUAL ad link_url is baked
  // server-side in lib/engine/adlaunch.ts and stays on the canonical host on purpose — a live
  // ad's destination must never depend on a workspace slug that can be renamed.
  const previewUrl =
    typeof window !== "undefined" ? `${window.location.origin}/p/${campaignId}/bridge` : "";

  if (launch?.status === "building") {
    return (
      <div className="mt-2 flex items-center gap-2 rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-xs text-sky-300">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Building your {launch.creative_kind} ad draft
        on Meta (paused, nothing spends yet)…
      </div>
    );
  }
  if (launch?.status === "activating") {
    return (
      <div className="mt-2 rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-xs text-sky-300">
        <div className="flex items-center gap-2">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Activation is in progress or needs to resume.
        </div>
        <Button onClick={activate} disabled={busy} variant="outline" className="mt-2 !py-1 text-xs">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Megaphone className="h-3.5 w-3.5" />}
          Resume activation
        </Button>
        {error && <p className="mt-1.5 text-xs text-red-300">{error}</p>}
      </div>
    );
  }
  if (launch?.status === "active") {
    return (
      <div className="mt-2 flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
        <CheckCircle2 className="h-3.5 w-3.5" /> Live on Meta ({launch.creative_kind}) —{" "}
        {launch.budget_credits} credits/day authorized.
      </div>
    );
  }
  if (launch?.status === "paused_review") {
    return (
      <div className="mt-2 rounded-lg border border-ink-700 p-3">
        <div className="mb-1.5 text-xs text-zinc-100">
          {launch.creative_kind === "video" ? "Video" : "Image"} ad draft ready — paused, review
          before going live
        </div>
        <div className="mb-2 space-y-0.5 text-[12px] text-zinc-400">
          <div>Budget: {launch.budget_credits} credits/day (≈ ${launch.budget_credits}/day)</div>
          <div>
            Links to:{" "}
            <a href={previewUrl} target="_blank" rel="noreferrer" className="text-emerald-400 underline">
              {previewUrl}
            </a>
          </div>
        </div>
        <Button onClick={activate} disabled={busy} className="text-xs">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Megaphone className="h-3.5 w-3.5" />}
          Activate — spend {launch.budget_credits} credits
        </Button>
        {error && <p className="mt-1.5 text-xs text-red-400">{error}</p>}
      </div>
    );
  }
  if (launch?.status === "failed") {
    return (
      <div className="mt-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3">
        <p className="mb-1.5 text-xs text-red-300">Launch failed: {launch.notes ?? "Unknown error"}</p>
        <p className="mb-2 text-[12px] text-zinc-500">Any reserved credits were refunded automatically.</p>
        <Button onClick={() => setLaunch(null)} variant="outline" className="!py-1 text-xs">
          Try again
        </Button>
      </div>
    );
  }

  if (!readyKinds.image && !readyKinds.video) {
    return (
      <div className="mt-2 rounded-lg border border-ink-700 bg-ink-800/50 p-3 text-xs text-zinc-500">
        Generate an image or video above to launch this angle as a real ad.
      </div>
    );
  }

  return (
    <div className="mt-2 rounded-lg border border-ink-700 p-3">
      <div className="mb-1.5 flex items-center gap-1.5 text-[12px] text-zinc-500">
        <Megaphone className="h-3.5 w-3.5" /> Launch on {adAccount.ad_account_name} → {page.page_name} —
        paused until you confirm
      </div>
      <label className="mb-1 block text-[12px] font-medium text-zinc-400">Headline</label>
      <input
        value={headline}
        onChange={(e) => setHeadline(e.target.value)}
        className="mb-1.5 w-full rounded-lg border border-ink-600 bg-ink-900 px-2.5 py-1.5 text-xs outline-none focus:border-emerald-500"
      />
      <label className="mb-1 block text-[12px] font-medium text-zinc-400">Primary text</label>
      <textarea
        value={primaryText}
        onChange={(e) => setPrimaryText(e.target.value)}
        rows={2}
        className="mb-1.5 w-full rounded-lg border border-ink-600 bg-ink-900 p-2.5 text-xs outline-none focus:border-emerald-500"
      />
      <div className="mb-2 flex items-center gap-2">
        <div>
          <label className="mb-1 block text-[12px] font-medium text-zinc-400">Daily budget (credits)</label>
          <input
            type="number"
            min={1}
            value={budget}
            onChange={(e) => setBudget(Number(e.target.value) || 1)}
            className="w-24 rounded-lg border border-ink-600 bg-ink-900 px-2.5 py-1.5 text-xs outline-none focus:border-emerald-500"
          />
        </div>
        <div>
          <label className="mb-1 block text-[12px] font-medium text-zinc-400">Country</label>
          <input
            value={country}
            onChange={(e) => setCountry(e.target.value.toUpperCase())}
            maxLength={2}
            className="w-16 rounded-lg border border-ink-600 bg-ink-900 px-2.5 py-1.5 text-xs outline-none focus:border-emerald-500"
          />
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {readyKinds.image && (
          <Button
            onClick={() => createDraft("image")}
            disabled={busy || !headline.trim() || !primaryText.trim()} className="text-xs">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Megaphone className="h-3.5 w-3.5" />}
            Launch as image ad
          </Button>
        )}
        {readyKinds.video && (
          <Button
            onClick={() => createDraft("video")}
            disabled={busy || !headline.trim() || !primaryText.trim()} className="text-xs">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Megaphone className="h-3.5 w-3.5" />}
            Launch as video ad
          </Button>
        )}
      </div>
      {error && <p className="mt-1.5 text-xs text-red-400">{error}</p>}
    </div>
  );
}
