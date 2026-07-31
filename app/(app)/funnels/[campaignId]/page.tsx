"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, LayoutDashboard } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Campaign, FunnelStep, BridgeVariant } from "@/lib/shared";
import PublishBridge from "@/components/PublishBridge";
import PageEditor from "@/components/PageEditor";
import SplitTestPanel from "@/components/SplitTestPanel";
import FunnelMap from "@/components/FunnelMap";
import FunnelStepEditor from "@/components/FunnelStepEditor";
import TrackingPanel from "@/components/TrackingPanel";
import type { TrackingSettings } from "@/lib/engine/renderPages";

const STEP_LABELS: Record<FunnelStep["step_type"], string> = {
  thank_you: "Thank-you",
  upsell: "Upsell",
  order: "Order",
};

// "map" (default) shows the funnel as a sequence of pages; selecting one switches to a focused
// editor view for just that page — mirrors picking a slide before editing it, not everything
// inline on one long scroll.
type View = { kind: "map" } | { kind: "optin" } | { kind: "variant"; variantId: string } | { kind: "step"; stepId: string };

export default function FunnelPage({ params }: { params: { campaignId: string } }) {
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [productTitle, setProductTitle] = useState("");
  const [steps, setSteps] = useState<FunnelStep[]>([]);
  const [crossSellOptions, setCrossSellOptions] = useState<{ id: string; title: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [view, setView] = useState<View>({ kind: "map" });
  const [variantInView, setVariantInView] = useState<BridgeVariant | null>(null);

  // Fetched on demand (not preloaded with the rest of the page) since a variant is only ever
  // reachable by clicking it in components/SplitTestBranch.tsx's own map-integrated fetch — no
  // other part of this page needs the full variant row otherwise.
  useEffect(() => {
    if (view.kind !== "variant") {
      setVariantInView(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await createClient().from("bridge_variants").select("*").eq("id", view.variantId).maybeSingle();
      if (!cancelled) setVariantInView(data as BridgeVariant | null);
    })();
    return () => {
      cancelled = true;
    };
  }, [view]);

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data: c } = await supabase
      .from("campaigns")
      .select("*, products(product_title)")
      .eq("id", params.campaignId)
      .maybeSingle();

    if (!c) {
      setNotFound(true);
      setLoading(false);
      return;
    }

    setCampaign(c as unknown as Campaign);
    setProductTitle((c as any).products?.product_title ?? "Untitled");

    const [{ data: stepRows }, { data: products }] = await Promise.all([
      supabase
        .from("funnel_steps")
        .select("*")
        .eq("campaign_id", params.campaignId)
        .order("step_index", { ascending: true }),
      supabase.from("products").select("id, product_title").neq("id", (c as any).product_id),
    ]);

    setSteps((stepRows ?? []) as FunnelStep[]);
    setCrossSellOptions((products ?? []).map((p: any) => ({ id: p.id, title: p.product_title })));
    setLoading(false);
  }, [params.campaignId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <p className="text-sm text-zinc-500">Loading…</p>;
  if (notFound || !campaign) {
    return (
      <main className="space-y-4">
        <Link href="/funnels" className="inline-flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-200">
          <ArrowLeft className="h-4 w-4" /> Back to Funnels
        </Link>
        <p className="text-sm text-zinc-500">Funnel not found.</p>
      </main>
    );
  }

  const stepInView = view.kind === "step" ? steps.find((s) => s.id === view.stepId) ?? null : null;

  // Editing a page takes over the whole viewport (no sidebar/app chrome) — the canvas needs the
  // room, and a focused editor shouldn't compete with app navigation. Rendered as a fixed overlay
  // above the (app) layout rather than a separate route, so all the existing view-switching state
  // stays exactly as it is; the sticky top bar carries the two ways out (funnel map / dashboard).
  if (view.kind !== "map") {
    const editorTitle =
      view.kind === "optin"
        ? "Opt-in page"
        : view.kind === "variant"
          ? variantInView
            ? `Opt-in page (${variantInView.label})`
            : "Opt-in page"
          : stepInView
            ? STEP_LABELS[stepInView.step_type]
            : "Step";

    return (
      <div className="fixed inset-0 z-40 overflow-y-auto bg-ink-950">
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-ink-700 bg-ink-900/90 px-4 py-3 backdrop-blur">
          <button
            onClick={() => setView({ kind: "map" })}
            className="inline-flex shrink-0 items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-200"
          >
            <ArrowLeft className="h-4 w-4" /> Funnel map
          </button>
          <div className="min-w-0 truncate text-sm font-medium text-zinc-100">
            {productTitle} — {editorTitle}
          </div>
          <Link
            href="/dashboard"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-ink-600 px-2.5 py-1.5 text-xs text-zinc-300 hover:border-emerald-500 hover:text-emerald-300"
          >
            <LayoutDashboard className="h-3.5 w-3.5" /> Dashboard
          </Link>
        </div>

        {/* Full-bleed: the editor overlay owns the whole viewport, no centered max-width column. */}
        <div className="px-4 py-6">
          {view.kind === "optin" ? (
            <>
              <SplitTestPanel campaignId={campaign.id} productTitle={productTitle} />

              <section className="card p-4">
                <PageEditor
                  campaignId={campaign.id}
                  productTitle={productTitle}
                  initialCopy={campaign.page_copy}
                  initialBridgeHtml={campaign.bridge_html}
                  showSeo
                  initialSeoTitle={(campaign as any).seo_title ?? null}
                  initialSeoDescription={(campaign as any).seo_description ?? null}
                  onSaved={({ bridge_html, page_copy }) =>
                    setCampaign((c) => (c ? { ...c, bridge_html, page_copy } : c))
                  }
                />
              </section>
            </>
          ) : view.kind === "variant" ? (
            variantInView ? (
              <section className="card p-4">
                <PageEditor
                  campaignId={campaign.id}
                  productTitle={productTitle}
                  initialCopy={variantInView.page_copy}
                  initialBridgeHtml={variantInView.bridge_html}
                  saveEndpoint={`/api/bridge-variants/${variantInView.id}`}
                  onSaved={({ bridge_html, page_copy }) =>
                    setVariantInView((v) => (v ? { ...v, bridge_html, page_copy } : v))
                  }
                />
              </section>
            ) : (
              <p className="text-sm text-zinc-500">Loading…</p>
            )
          ) : stepInView ? (
            <section className="card p-4">
              <FunnelStepEditor
                stepId={stepInView.id}
                stepType={stepInView.step_type}
                productTitle={productTitle}
                initialCopy={stepInView.page_copy}
                initialHtml={stepInView.html}
                initialCtaAction={stepInView.cta_action}
                initialRedirectUrl={stepInView.redirect_url}
                initialTargetProductId={stepInView.target_product_id}
                initialDeclineAction={stepInView.decline_action}
                initialDeclineRedirectUrl={stepInView.decline_redirect_url}
                initialSeoTitle={(stepInView as any).seo_title ?? null}
                initialSeoDescription={(stepInView as any).seo_description ?? null}
                crossSellOptions={crossSellOptions}
                onSaved={() => load()}
              />
            </section>
          ) : (
            <p className="text-sm text-zinc-500">
              That step no longer exists.{" "}
              <button onClick={() => setView({ kind: "map" })} className="underline">
                Back to funnel map
              </button>
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <main className="space-y-5">
      <Link href="/funnels" className="inline-flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-200">
        <ArrowLeft className="h-4 w-4" /> Back to Funnels
      </Link>

      <header>
        <h1 className="text-2xl font-bold text-zinc-100">{productTitle}</h1>
        <p className="text-sm text-zinc-400">
          Publishing is one switch for the whole funnel — the opt-in page and every step below go
          live (or offline) together.
        </p>
      </header>

      {!campaign.page_copy ? (
        <p className="rounded-lg bg-ink-800 p-4 text-sm text-zinc-400">
          This campaign was generated before the no-code editor existed, so there's no structured
          copy to edit yet. Regenerate the campaign kit from the{" "}
          <Link href="/marketplace" className="underline">
            Marketplace
          </Link>{" "}
          page to enable editing.
        </p>
      ) : (
        <>
          <PublishBridge campaignId={campaign.id} initialPublished={campaign.bridge_published} />

          <FunnelMap
            campaignId={campaign.id}
            bridgeHtml={campaign.bridge_html}
            steps={steps}
            onSelectOptin={() => setView({ kind: "optin" })}
            onSelectVariant={(variantId) => setView({ kind: "variant", variantId })}
            onSelectStep={(stepId) => setView({ kind: "step", stepId })}
            onChanged={load}
          />

          <TrackingPanel
            campaignId={campaign.id}
            initialTracking={((campaign as unknown as { tracking?: TrackingSettings | null }).tracking ?? null)}
          />
        </>
      )}
    </main>
  );
}
