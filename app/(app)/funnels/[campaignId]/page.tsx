"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, LayoutDashboard, Sparkles } from "lucide-react";
import { toast } from "@/lib/toast";
import { createClient } from "@/lib/supabase/client";
import type { Campaign, FunnelStep, BridgeVariant } from "@/lib/shared";
import PublishBridge from "@/components/PublishBridge";
import OfferLinkPanel from "@/components/OfferLinkPanel";
import PageEditor from "@/components/PageEditor";
import PromoteKitDialog from "@/components/PromoteKitDialog";
import RestyleDialog from "@/components/RestyleDialog";
import BuildProgressDialog from "@/components/BuildProgressDialog";
import FunnelMap from "@/components/FunnelMap";
import FunnelStepEditor from "@/components/FunnelStepEditor";
import FunnelSettingsDialog from "@/components/FunnelSettingsDialog";
import type { TrackingSettings } from "@/lib/engine/renderPages";
import { Card } from "@/components/ui/card";

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
  const [regenOpen, setRegenOpen] = useState(false);
  const [restyleOpen, setRestyleOpen] = useState(false);
  const [regenBusy, setRegenBusy] = useState(false);
  const [regenJobIds, setRegenJobIds] = useState<string[]>([]);
  // Bumped after anything rewrites the page server-side, to force PageEditor to remount and
  // re-seed from the reloaded row — see the `key` on it below for why new props aren't enough.
  const [editorNonce, setEditorNonce] = useState(0);

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
    // Explicit columns, not `*`. campaigns rows average 166 kB and reach 766 kB; this editor needs
    // page_copy and bridge_html (it IS the page editor) but has no use for the ad/blog/email/social
    // copy, the legacy presell_html/landing_md, or the video columns. tracking IS needed —
    // Tracking lives behind the map view's ⚙ (FunnelSettingsDialog).
    //
    // A column missing here is invisible to tsc and shows up as an empty control, so this list has
    // to grow when a consumer does.
    const { data: c } = await supabase
      .from("campaigns")
      .select(
        "id, product_id, workspace_id, name, status, cta_url, bridge_published, bridge_html, " +
          "page_copy, page_copy_edited_at, embedded_image_data_url, tracking, created_at, updated_at, " +
          "products(product_title)"
      )
      .eq("id", params.campaignId)
      .maybeSingle();

    if (!c) {
      setNotFound(true);
      setLoading(false);
      return;
    }

    setCampaign(c as unknown as Campaign);
    // A hand-built funnel has no product to borrow a title from, so it carries its own name.
    setProductTitle((c as any).products?.product_title ?? (c as any).name ?? "Untitled");

    const [{ data: stepRows }, { data: products }] = await Promise.all([
      supabase
        .from("funnel_steps")
        .select("*")
        .eq("campaign_id", params.campaignId)
        .order("step_index", { ascending: true }),
      // Cross-sell options for an upsell step. Scoped to this campaign's workspace and bounded:
      // it was unfiltered and unlimited, so a member of two workspaces got both workspaces'
      // products merged into one dropdown, and the list grew without limit as products accumulated.
      supabase
        .from("products")
        .select("id, product_title")
        .eq("workspace_id", (c as any).workspace_id)
        .neq("id", (c as any).product_id)
        .order("updated_at", { ascending: false })
        .limit(200),
    ]);

    setSteps((stepRows ?? []) as FunnelStep[]);
    setCrossSellOptions((products ?? []).map((p: any) => ({ id: p.id, title: p.product_title })));
    setLoading(false);
  }, [params.campaignId]);

  useEffect(() => {
    load();
  }, [load]);

  // Re-read the row AND remount the editor. Both halves are needed: without the reload the canvas
  // shows stale copy, and without the remount PageEditor keeps the tree it seeded at mount — so a
  // Save afterwards would write the pre-regeneration copy back over what was just generated.
  const refreshEditor = useCallback(async () => {
    await load();
    setEditorNonce((n) => n + 1);
  }, [load]);

  // Same call as the product page's own regenerate, pointed at this funnel's product — one route,
  // one credit path. A funnel with no product can't reach here (the button is disabled), but the
  // guard stays because `product_id` is nullable since 0068.
  //
  // This addresses the campaign by its PRODUCT, not by its own id, because that is what
  // /api/promote takes. It lands on the right funnel because the engine keeps one campaign per
  // product — `upsertCampaign` looks the campaign up with `.maybeSingle()` on product_id — and
  // hand-built funnels carry no product at all. That is a convention, not a database constraint:
  // if a second campaign is ever allowed to share a product, this button would need to name the
  // campaign instead, and upsertCampaign would start throwing before it got the chance.
  async function runRegenerate(assets: string[], counts: Record<string, number>) {
    if (!campaign?.product_id) return;
    setRegenBusy(true);
    const res = await fetch("/api/promote", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ product_id: campaign.product_id, assets, counts }),
    });
    const d = await res.json().catch(() => ({}));
    setRegenBusy(false);
    if (!res.ok) {
      toast.error(d.error ?? "Couldn't start that regeneration");
      return;
    }
    setRegenOpen(false);
    if (d.job_id) setRegenJobIds([d.job_id]);
  }

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
          <div className="flex shrink-0 items-center gap-2">
            {/* Opt-in view only. Regenerating rewrites THIS page's copy (stagePages writes
                bridge_html/page_copy) — offering it while a step or a variant is open would
                silently rewrite a different page than the one on screen. */}
            {view.kind === "optin" &&
              (campaign.product_id ? (
                <button
                  onClick={() => setRegenOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-ink-600 px-2.5 py-1.5 text-xs text-zinc-300 hover:border-emerald-500 hover:text-emerald-300"
                >
                  <Sparkles className="h-3.5 w-3.5" /> Regenerate
                </button>
              ) : (
                // Shown disabled with the reason rather than hidden, same call as the unbuildable
                // funnel types: someone looking for this button should learn why it isn't offered.
                <span
                  className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-lg border border-ink-700 px-2.5 py-1.5 text-xs text-zinc-600"
                  title="This funnel isn't attached to a product, so there's no sales page to write from. Attach one, or edit the copy by hand."
                >
                  <Sparkles className="h-3.5 w-3.5" /> Regenerate
                </span>
              ))}
            <Link
              href="/dashboard"
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-ink-600 px-2.5 py-1.5 text-xs text-zinc-300 hover:border-emerald-500 hover:text-emerald-300"
            >
              <LayoutDashboard className="h-3.5 w-3.5" /> Dashboard
            </Link>
          </div>
        </div>

        <PromoteKitDialog
          open={regenOpen}
          onOpenChange={setRegenOpen}
          count={1}
          busy={regenBusy}
          mode="regenerate"
          // The button says "Regenerate", so the page it regenerates starts ticked. Everything
          // else in the kit stays offerable underneath it.
          defaultAssets={["funnel"]}
          funnelEditedAt={(campaign as { page_copy_edited_at?: string | null }).page_copy_edited_at ?? null}
          onRestyle={() => {
            setRegenOpen(false);
            setRestyleOpen(true);
          }}
          onConfirm={runRegenerate}
        />
        <RestyleDialog
          open={restyleOpen}
          onOpenChange={setRestyleOpen}
          campaignId={campaign.id}
          onDone={refreshEditor}
        />
        <BuildProgressDialog
          open={regenJobIds.length > 0}
          onOpenChange={(o) => !o && setRegenJobIds([])}
          jobIds={regenJobIds}
          titleByJobId={Object.fromEntries(regenJobIds.map((id) => [id, productTitle]))}
          // The whole point of the button: the canvas must show what was just written, not the
          // copy it was seeded with when the editor opened.
          onAllDone={refreshEditor}
        />

        {/* Full-bleed: the editor overlay owns the whole viewport, no centered max-width column. */}
        <div className="px-4 py-6">
          {view.kind === "optin" ? (
            <Card as="section" className="p-4">
              <PageEditor
                // Remounted after a regeneration. PageEditor seeds its block tree in a useState
                // initialiser, so new props alone would leave the canvas showing the OLD copy over
                // freshly-written rows — and the next Save would put the old copy back.
                key={editorNonce}
                campaignId={campaign.id}
                productTitle={productTitle}
                initialCopy={campaign.page_copy}
                initialBridgeHtml={campaign.bridge_html}
                funnelType={(campaign as any).funnel_type ?? null}
                showSeo
                initialSeoTitle={(campaign as any).seo_title ?? null}
                initialSeoDescription={(campaign as any).seo_description ?? null}
                onSaved={({ bridge_html, page_copy }) =>
                  setCampaign((c) => (c ? { ...c, bridge_html, page_copy } : c))
                }
              />
            </Card>
          ) : view.kind === "variant" ? (
            variantInView ? (
              <Card as="section" className="p-4">
                <PageEditor
                  campaignId={campaign.id}
                  productTitle={productTitle}
                  initialCopy={variantInView.page_copy}
                  initialBridgeHtml={variantInView.bridge_html}
                  // A variant is the same page with different copy, so it's held to the same
                  // funnel type's requirements as the control.
                  funnelType={(campaign as any).funnel_type ?? null}
                  saveEndpoint={`/api/bridge-variants/${variantInView.id}`}
                  onSaved={({ bridge_html, page_copy }) =>
                    setVariantInView((v) => (v ? { ...v, bridge_html, page_copy } : v))
                  }
                />
              </Card>
            ) : (
              <p className="text-sm text-zinc-500">Loading…</p>
            )
          ) : stepInView ? (
            <Card as="section" className="p-4">
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
            </Card>
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

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-zinc-100">{productTitle}</h1>
          <p className="text-sm text-zinc-400">
            Publishing is one switch for the whole funnel — the opt-in page and every step below go
            live (or offline) together.
          </p>
        </div>
        {campaign.page_copy && (
          <FunnelSettingsDialog
            campaignId={campaign.id}
            tracking={(campaign as unknown as { tracking?: TrackingSettings | null }).tracking ?? null}
            onSaved={load}
          />
        )}
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
          {/* Only without a product: with one, the affiliate hoplink is the destination and this
              would be a second control claiming to set the same thing. */}
          {!(campaign as any).product_id && (
            <OfferLinkPanel
              campaignId={campaign.id}
              initialUrl={(campaign as any).cta_url ?? null}
              onSaved={load}
            />
          )}

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
        </>
      )}
    </main>
  );
}
