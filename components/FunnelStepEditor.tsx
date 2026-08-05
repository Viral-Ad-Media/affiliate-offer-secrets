"use client";

import { useState } from "react";
import { Loader2, CheckCircle2, Lock } from "lucide-react";
import {
  DISCLOSURE,
  normalizePageCopy,
  firstImageDataUrl,
  renderFunnelStepHtml,
  renderBlockTree,
  type PageBlockTree,
  type FunnelStepType,
} from "@/lib/engine/renderPages";
import EditorPreviewButton from "@/components/EditorPreview";
import type { FunnelStepCtaAction } from "@/lib/shared";
import WysiwygCanvas from "@/components/WysiwygCanvas";
import ContentWidthField from "@/components/ContentWidthField";
import PageThemePanel from "@/components/PageThemePanel";
import PostSeoPanel from "@/components/PostSeoPanel";
import SeoFields, { type SeoValues } from "@/components/SeoFields";
import { resizeImageFile } from "@/lib/images/resizeClient";
import { Button } from "@/components/ui/button";


// Same client-side downscale as PageEditor.tsx's resizeImageFile — the server's own validation
// (app/api/funnel-steps/[id]/route.ts) is the actual boundary, this is just UX.

type Props = {
  stepId: string;
  stepType: FunnelStepType;
  productTitle: string;
  initialCopy: unknown;
  initialHtml: string | null;
  initialCtaAction: FunnelStepCtaAction;
  initialRedirectUrl: string | null;
  initialTargetProductId: string | null;
  initialDeclineAction: FunnelStepCtaAction;
  initialDeclineRedirectUrl: string | null;
  initialSeoTitle: string | null;
  initialSeoDescription: string | null;
  crossSellOptions: { id: string; title: string }[];
  onSaved: (result: { html: string; page_copy: PageBlockTree }) => void;
};

export default function FunnelStepEditor({
  stepId,
  stepType,
  productTitle,
  initialCopy,
  initialCtaAction,
  initialRedirectUrl,
  initialTargetProductId,
  initialDeclineAction,
  initialDeclineRedirectUrl,
  initialSeoTitle,
  initialSeoDescription,
  crossSellOptions,
  onSaved,
}: Props) {
  const [tree, setTree] = useState<PageBlockTree>(() => normalizePageCopy(initialCopy, null, { stepType }));
  const [ctaAction, setCtaAction] = useState<FunnelStepCtaAction>(initialCtaAction);
  const [redirectUrl, setRedirectUrl] = useState(initialRedirectUrl ?? "");
  const [targetProductId, setTargetProductId] = useState<string>(initialTargetProductId ?? "");
  const [declineAction, setDeclineAction] = useState<FunnelStepCtaAction>(initialDeclineAction);
  const [declineRedirectUrl, setDeclineRedirectUrl] = useState(initialDeclineRedirectUrl ?? "");
  const [seo, setSeo] = useState<SeoValues>({
    seo_title: initialSeoTitle ?? "",
    seo_description: initialSeoDescription ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [imageBusyBlockId, setImageBusyBlockId] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/funnel-steps/${stepId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          blocks: tree.blocks,
          contentWidth: tree.contentWidth,
          theme: tree.theme,
          image_data_url: firstImageDataUrl(tree),
          cta_action: ctaAction,
          redirect_url: ctaAction === "redirect_url" ? redirectUrl : null,
          target_product_id: targetProductId || null,
          decline_action: declineAction,
          decline_redirect_url: declineAction === "redirect_url" ? declineRedirectUrl : null,
          ...seo,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save");
      onSaved({ html: data.html, page_copy: tree });
      setSavedAt(Date.now());
    } catch (err: any) {
      setError(err?.message ?? "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-zinc-500">
        Click any text below to edit it in place, drag <span className="text-zinc-400">⠿</span> to
        reorder a block.
      </p>

      <SeoFields
        values={seo}
        onChange={setSeo}
        fallbackTitle={productTitle}
        noteWhenNoindex="Funnel pages are never indexed by search engines — these control how the page looks when the URL is shared."
      />

      <WysiwygCanvas
        tree={tree}
        onChange={setTree}
        resizeImageFile={resizeImageFile}
        imageBusyBlockId={imageBusyBlockId}
        onImageBusyChange={setImageBusyBlockId}
        onImageError={setError}
        productTitle={productTitle}
        settings={{
          title: "Step settings",
          panel: (
            <div className="space-y-4">
              <ContentWidthField tree={tree} onChange={setTree} />
              <PageThemePanel tree={tree} onChange={setTree} />
              {/* Same analyzePostSeo the blog editor runs, in funnel mode — see lib/blogSeo.ts for
                  which checks drop out and why. Scored from the CURRENT tree, not the last save. */}
              <PostSeoPanel
                input={{
                  title: seo.seo_title || productTitle,
                  contentMd: "",
                  html: renderBlockTree(tree, { pageKind: "bridge", disclosureText: DISCLOSURE, leadConsentText: "", campaignId: "", primaryHref: "#", productTitle }),
                  seoTitle: seo.seo_title,
                  seoDescription: seo.seo_description,
                  featuredImageUrl: firstImageDataUrl(tree),
                  pageKind: "funnel",
                }}
              />
            </div>
          ),
        }}
      />

      <p className="mx-auto flex max-w-[680px] items-center gap-1.5 text-xs text-zinc-500">
        <Lock className="h-3 w-3 shrink-0" /> {DISCLOSURE}
      </p>

      <div className="space-y-3 rounded-lg border border-ink-700 p-3">
        {stepType === "upsell" ? (
          <>
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                When Accept is clicked
              </label>
              <select
                value={ctaAction}
                onChange={(e) => setCtaAction(e.target.value as FunnelStepCtaAction)}
                className="mt-1 w-full rounded-lg border border-ink-600 bg-ink-800 px-3 py-2 text-sm text-zinc-100"
              >
                <option value="hoplink">Go to a product's hoplink</option>
                <option value="next_step">Continue to the next step (or the hoplink, if last)</option>
                <option value="redirect_url">Redirect to a custom URL</option>
              </select>
              {ctaAction === "hoplink" && (
                <select
                  value={targetProductId}
                  onChange={(e) => setTargetProductId(e.target.value)}
                  className="mt-2 w-full rounded-lg border border-ink-600 bg-ink-800 px-3 py-2 text-sm text-zinc-100"
                >
                  <option value="">This funnel's own product</option>
                  {crossSellOptions.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title}
                    </option>
                  ))}
                </select>
              )}
              {ctaAction === "redirect_url" && (
                <input
                  value={redirectUrl}
                  onChange={(e) => setRedirectUrl(e.target.value)}
                  placeholder="https://example.com/checkout"
                  maxLength={2000}
                  className="mt-2 w-full rounded-lg border border-ink-600 bg-ink-800 px-3 py-2 text-sm text-zinc-100"
                />
              )}
            </div>

            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                When "No thanks, continue" is clicked
              </label>
              <select
                value={declineAction}
                onChange={(e) => setDeclineAction(e.target.value as FunnelStepCtaAction)}
                className="mt-1 w-full rounded-lg border border-ink-600 bg-ink-800 px-3 py-2 text-sm text-zinc-100"
              >
                <option value="next_step">Continue to the next step (or the original hoplink, if last)</option>
                <option value="hoplink">Go straight to the original product's hoplink</option>
                <option value="redirect_url">Redirect to a custom URL</option>
              </select>
              {declineAction === "redirect_url" && (
                <input
                  value={declineRedirectUrl}
                  onChange={(e) => setDeclineRedirectUrl(e.target.value)}
                  placeholder="https://example.com/no-thanks"
                  maxLength={2000}
                  className="mt-2 w-full rounded-lg border border-ink-600 bg-ink-800 px-3 py-2 text-sm text-zinc-100"
                />
              )}
            </div>
          </>
        ) : (
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              When clicked, this CTA should
            </label>
            <select
              value={ctaAction}
              onChange={(e) => setCtaAction(e.target.value as FunnelStepCtaAction)}
              className="mt-1 w-full rounded-lg border border-ink-600 bg-ink-800 px-3 py-2 text-sm text-zinc-100"
            >
              <option value="next_step">Continue to the next step (or the hoplink, if last)</option>
              <option value="hoplink">Go straight to the hoplink</option>
              <option value="redirect_url">Redirect to a custom URL</option>
            </select>
            {ctaAction === "redirect_url" && (
              <input
                value={redirectUrl}
                onChange={(e) => setRedirectUrl(e.target.value)}
                placeholder="https://example.com/thank-you"
                maxLength={2000}
                className="mt-2 w-full rounded-lg border border-ink-600 bg-ink-800 px-3 py-2 text-sm text-zinc-100"
              />
            )}
          </div>
        )}
      </div>

      {error && <p className="text-sm text-red-300">{error}</p>}

      <div className="flex items-center gap-3">
        <EditorPreviewButton
          title={`Preview — ${productTitle}`}
          render={() =>
            renderFunnelStepHtml(
              { product_title: productTitle },
              tree,
              stepType,
              // The real CTA href is resolved server-side from cta_action/redirect_url at save
              // time; "#" keeps the preview inert rather than inventing a hoplink that isn't what
              // will actually ship.
              "#",
              firstImageDataUrl(tree)
            )
          }
        />
        <Button onClick={save} disabled={saving || !!imageBusyBlockId}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Save &amp; Republish
        </Button>
        {savedAt && Date.now() - savedAt < 4000 && (
          <span className="flex items-center gap-1 text-xs text-emerald-300">
            <CheckCircle2 className="h-3.5 w-3.5" /> Saved
          </span>
        )}
      </div>
    </div>
  );
}
