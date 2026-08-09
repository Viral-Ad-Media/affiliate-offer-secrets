"use client";

import { useState } from "react";
import { Loader2, CheckCircle2, Lock } from "lucide-react";
import { DISCLOSURE, normalizePageCopy, firstImageDataUrl, renderBlockTree, type PageBlockTree , renderBridgeHtml} from "@/lib/engine/renderPages";
import WysiwygCanvas from "@/components/WysiwygCanvas";
import ContentWidthField from "@/components/ContentWidthField";
import KeywordsField from "@/components/KeywordsField";
import PageThemePanel from "@/components/PageThemePanel";
import PostSeoPanel from "@/components/PostSeoPanel";
import EditorPreviewButton from "@/components/EditorPreview";
import SeoFields, { type SeoValues } from "@/components/SeoFields";
import PageChecklist from "@/components/PageChecklist";
import { funnelPageChecklist } from "@/lib/pageChecklist";
import { funnelType as funnelTypeDef } from "@/lib/funnelTypes";
import { resizeImageFile } from "@/lib/images/resizeClient";
import { Button } from "@/components/ui/button";


// Downscale/re-encode client-side so most real photos land under the server's size cap without
// the user having to think about it — the server's own validation (route.ts) is the actual
// boundary, this is just UX.

/** Display name for the checklist header, so it's clear which funnel type set these rules. */
function funnelTypeLabel(key: string): string | null {
  return funnelTypeDef(key)?.label ?? null;
}

type Props = {
  campaignId: string;
  productTitle: string;
  initialCopy: unknown;
  initialBridgeHtml: string | null;
  onSaved: (result: { bridge_html: string; page_copy: PageBlockTree }) => void;
  // Defaults to the control's own save route. A split-test variant's editor (SplitTestPanel)
  // passes /api/bridge-variants/{id} instead — everything else about this component is identical.
  saveEndpoint?: string;
  // Opt-in page SEO lives on the campaign row; split-test variants share the campaign's values,
  // so the variant editor (SplitTestPanel) simply doesn't pass these.
  initialSeoTitle?: string | null;
  initialSeoDescription?: string | null;
  showSeo?: boolean;
  /** lib/funnelTypes.ts key — drives which elements the checklist asks for. Null = generic list. */
  funnelType?: string | null;
};

export default function PageEditor({
  campaignId,
  productTitle,
  initialCopy,
  initialBridgeHtml,
  onSaved,
  saveEndpoint,
  initialSeoTitle,
  initialSeoDescription,
  showSeo = false,
  funnelType = null,
}: Props) {
  const [tree, setTree] = useState<PageBlockTree>(() => normalizePageCopy(initialCopy, null));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [imageBusyBlockId, setImageBusyBlockId] = useState<string | null>(null);
  const [seo, setSeo] = useState<SeoValues>({
    seo_title: initialSeoTitle ?? "",
    seo_description: initialSeoDescription ?? "",
  });

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(saveEndpoint ?? `/api/campaigns/${campaignId}/page-copy`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          blocks: tree.blocks,
          contentWidth: tree.contentWidth,
          theme: tree.theme,
          image_data_url: firstImageDataUrl(tree),
          ...(showSeo ? seo : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save");
      onSaved({ bridge_html: data.bridge_html, page_copy: tree });
      setSavedAt(Date.now());
    } catch (err: any) {
      setError(err?.message ?? "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  if (!initialCopy) {
    return (
      <p className="rounded-lg bg-ink-800 p-4 text-sm text-zinc-400">
        This campaign was generated before the no-code editor existed, so there's no structured
        copy to edit yet. Regenerate the campaign kit to enable editing.
      </p>
    );
  }

  // One definition, rendered both above and below the canvas. The canvas is tall enough that
  // whichever end you happen to be at, the actions had better be there — and two copies of one
  // JSX value can't drift into disagreeing about disabled state or the saved indicator.
  const actions = (
    <div className="flex items-center gap-3">
      <EditorPreviewButton
        title={`Preview — ${productTitle}`}
        render={() =>
          renderBridgeHtml(
            { product_title: productTitle },
            tree,
            // Inert placeholder: the real hoplink is built server-side from the tenant's own
            // affiliate id at save time, so inventing one here would preview a link that isn't
            // what ships.
            "#",
            firstImageDataUrl(tree),
            campaignId
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
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-zinc-500">
          Click any text below to edit it in place, drag <span className="text-zinc-400">⠿</span> to
          reorder a block. The lead-capture form and disclosure are locked — they can't be edited
          or removed here.
        </p>
        {actions}
      </div>

      <WysiwygCanvas
        tree={tree}
        onChange={setTree}
        resizeImageFile={resizeImageFile}
        imageBusyBlockId={imageBusyBlockId}
        onImageBusyChange={setImageBusyBlockId}
        onImageError={setError}
        productTitle={productTitle}
        settings={{
          title: "Page settings",
          panel: (
            <div className="space-y-4">
              {/* Recomputed from the live tree on every edit, so ticking an item is immediate
                  feedback rather than something you learn after saving. It lives behind the ⚙ with
                  the other page-level settings: it describes the PAGE, not any block on it, and
                  above the canvas it pushed the actual editing surface down the screen — the same
                  reasoning that moved the blog editor's SEO fields here. */}
              <PageChecklist
                items={funnelPageChecklist(funnelType, tree)}
                subtitle={funnelType ? (funnelTypeLabel(funnelType) ?? undefined) : undefined}
              />
              <KeywordsField tree={tree} onChange={setTree} />
              <ContentWidthField tree={tree} onChange={setTree} />
              <PageThemePanel tree={tree} onChange={setTree} />
              {/* SEO lives behind the ⚙ with the other page-level settings, the way the blog post
                  editor already does it — it's about the page, not about a block on it, and above
                  the canvas it pushed the actual editing surface down the screen. */}
              {showSeo && (
                <SeoFields
                  values={seo}
                  onChange={setSeo}
                  fallbackTitle={productTitle}
                  noteWhenNoindex="Funnel pages are never indexed by search engines — these control how the page looks when the URL is shared."
                />
              )}
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

      {error && <p className="text-sm text-red-300">{error}</p>}

      {actions}
    </div>
  );
}
