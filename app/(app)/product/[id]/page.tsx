"use client";

import { useCallback, useEffect, useState } from "react";
import HoplinkOverride from "@/components/HoplinkOverride";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { marked } from "marked";
import { ArrowLeft, Copy, CheckCircle2, ExternalLink, Download, Layers, RefreshCw, Palette } from "lucide-react";
import type { Campaign, Product } from "@/lib/shared";
import ProductStatusSelect from "@/components/ProductStatusSelect";
import PromoteKitDialog from "@/components/PromoteKitDialog";
import RestyleDialog from "@/components/RestyleDialog";
import BuildProgressDialog from "@/components/BuildProgressDialog";
import { toast } from "@/lib/toast";
import SendEmail from "@/components/SendEmail";
import GenerateVideo from "@/components/GenerateVideo";
import AdAnglesPanel from "@/components/AdAnglesPanel";
import SocialPostsPanel from "@/components/SocialPostsPanel";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const TABS = [
  { key: "fb_ads_md", label: "FB/IG Ads" },
  { key: "tiktok_md", label: "TikTok" },
  { key: "bridge_html", label: "Bridge page" },
  { key: "blog_md", label: "Blog" },
  { key: "social_md", label: "Social" },
  { key: "email_md", label: "Emails" },
  { key: "hoplinks_txt", label: "Hoplinks" },
] as const;

export default function ProductPage({ params }: { params: { id: string } }) {
  const searchParams = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const initialTab =
    (TABS.find((t) => t.key === requestedTab)?.key as (typeof TABS)[number]["key"] | undefined) ??
    "fb_ads_md";

  const [product, setProduct] = useState<Product | null>(null);
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>(initialTab);
  // Regenerating from the kit page runs the SAME /api/promote the marketplace does — it is a build
  // on a product that already has one — so entitlement, the credit charge and the rollback all stay
  // in the one place that owns them.
  const [regenOpen, setRegenOpen] = useState(false);
  const [restyleOpen, setRestyleOpen] = useState(false);
  const [regenBusy, setRegenBusy] = useState(false);
  const [regenJob, setRegenJob] = useState<{ jobIds: string[]; titles: Record<string, string> } | null>(null);

  async function runRegenerate(assets: string[]) {
    if (!product) return;
    setRegenBusy(true);
    const res = await fetch("/api/promote", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ product_id: product.id, assets }),
    });
    const d = await res.json().catch(() => ({}));
    setRegenBusy(false);
    if (!res.ok) {
      toast.error(d.error ?? "Couldn't start that regeneration");
      return;
    }
    setRegenOpen(false);
    if (d.job_id) {
      setRegenJob({ jobIds: [d.job_id], titles: { [d.job_id]: product.product_title ?? "Campaign kit" } });
    }
  }
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/products/${params.id}`);
    if (!res.ok) return;
    const data = await res.json();
    setProduct(data.product);
    setCampaign(data.campaign);
  }, [params.id]);

  useEffect(() => {
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [load]);

  if (!product) return <p className="text-sm text-zinc-500">Loading…</p>;

  const content = campaign ? ((campaign as any)[tab] as string | null) : null;

  // fb_ads_md/social_md are legacy flat strings; fb_ad_angles/social_posts are the new structured
  // arrays. Either counts as "has content" for the tab dot-indicator and the "not generated yet"
  // gate — everything else is still a single flat column.
  function hasTabContent(key: (typeof TABS)[number]["key"]): boolean {
    if (!campaign) return false;
    if (key === "fb_ads_md") return !!campaign.fb_ad_angles || !!campaign.fb_ads_md;
    if (key === "social_md") return !!campaign.social_posts || !!campaign.social_md;
    return !!(campaign as any)[key];
  }

  function copyHoplink() {
    // The custom link wins here too — copying the generated one while the kit uses an override
    // would hand out a link that credits nobody.
    const link = product?.hoplink_override || product?.hoplink;
    if (!link) return;
    navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function downloadHtml() {
    const html = campaign?.bridge_html;
    if (!html) return;
    const blob = new Blob([html], { type: "text/html" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${product!.vendor_id}-bridge.html`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <main className="space-y-5">
      <Link
        href="/marketplace"
        className="inline-flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-200"
      >
        <ArrowLeft className="h-4 w-4" /> Back to marketplace
      </Link>

      <Card as="header" className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-zinc-100">{product.product_title}</h1>
            <p className="mt-1 flex items-center gap-2 text-sm text-zinc-400">
              <Badge className="!py-0 !px-1.5 text-[11px] uppercase tracking-wide">
                {product.network === "digistore24" ? "Digistore24" : "ClickBank"}
              </Badge>
              {product.vendor_id} · {product.niche}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {campaign && (
              <>
                <Button onClick={() => setRegenOpen(true)} variant="outline" className="text-xs">
                  <RefreshCw className="h-3.5 w-3.5" /> Regenerate kit
                </Button>
                <Button onClick={() => setRestyleOpen(true)} variant="outline" className="text-xs">
                  <Palette className="h-3.5 w-3.5" /> Change design
                </Button>
              </>
            )}
            <ProductStatusSelect productId={product.id} status={product.status} onChanged={load} />
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
          <div>
            <div className="text-xs text-zinc-500">Gravity</div>
            <div className="font-semibold text-zinc-100">{product.gravity?.toFixed(1) ?? "—"}</div>
          </div>
          <div>
            <div className="text-xs text-zinc-500">Initial $/sale</div>
            <div className="font-semibold text-zinc-100">
              {product.initial_sale != null ? `$${product.initial_sale.toFixed(2)}` : "—"}
            </div>
          </div>
          <div>
            <div className="text-xs text-zinc-500">Avg $/sale</div>
            <div className="font-semibold text-zinc-100">
              {product.avg_sale != null ? `$${product.avg_sale.toFixed(2)}` : "—"}
            </div>
          </div>
          <div>
            <div className="text-xs text-zinc-500">Rebill</div>
            <div className="font-semibold text-zinc-100">
              {product.recurring ? `$${product.recurring.toFixed(2)}` : "—"}
            </div>
          </div>
          <div>
            <div className="text-xs text-zinc-500">Score</div>
            <div className="font-semibold text-zinc-100">{product.score ?? "—"}/10</div>
          </div>
        </div>
        {product.angle_notes && (
          <p className="mt-4 rounded-lg bg-ink-800 p-3 text-sm text-zinc-300">{product.angle_notes}</p>
        )}
        <HoplinkOverride
          productId={product.id}
          derived={product.hoplink}
          initialOverride={product.hoplink_override}
        />
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button onClick={copyHoplink}>
            {copied ? <CheckCircle2 className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            Copy hoplink
          </Button>
          {product.sales_page_url && (
            <a href={product.sales_page_url} target="_blank" rel="noreferrer" className={buttonVariants({ variant: "outline" })}>
              <ExternalLink className="h-4 w-4" /> Sales page
            </a>
          )}
          {product.affiliate_page_url && (
            <a href={product.affiliate_page_url} target="_blank" rel="noreferrer" className={buttonVariants({ variant: "outline" })}>
              <ExternalLink className="h-4 w-4" /> Affiliate tools
            </a>
          )}
          {product.assets_link && (
            <a href={product.assets_link} target="_blank" rel="noreferrer" className={buttonVariants({ variant: "outline" })}>
              <ExternalLink className="h-4 w-4" /> Drive folder
            </a>
          )}
        </div>
      </Card>

      <Card as="section">
        <div className="flex items-center justify-between border-b border-ink-700 px-4 py-3">
          <h2 className="text-sm font-semibold text-zinc-100">
            Campaign kit{" "}
            {campaign ? (
              <Badge
                className={`ml-2 ${
                  campaign.status === "ready"
                    ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-300"
                    : campaign.status === "error"
                      ? "border-red-500/30 bg-red-500/15 text-red-300"
                      : "border-sky-500/30 bg-sky-500/15 text-sky-300"
                }`}
              >
                {campaign.status}
              </Badge>
            ) : null}
          </h2>
          {tab === "bridge_html" && campaign?.bridge_html && (
            <div className="flex items-center gap-2">
              <Link href={`/funnels/${campaign.id}`} className={cn(buttonVariants(), "!py-1 text-xs")}>
                <Layers className="h-3.5 w-3.5" /> Manage &amp; publish this funnel
              </Link>
              <Button onClick={downloadHtml} variant="outline" className="!py-1 text-xs">
                <Download className="h-3.5 w-3.5" /> Download HTML
              </Button>
            </div>
          )}
        </div>

        {!campaign ? (
          <p className="px-4 py-10 text-center text-sm text-zinc-500">
            No campaign kit yet. Hit <strong>Promote</strong> on the Marketplace page to queue one — it
            builds automatically.
          </p>
        ) : (
          <>
            <div className="border-b border-ink-700 px-4 py-2">
              <Tabs value={tab} onValueChange={(v) => setTab(v as (typeof TABS)[number]["key"])}>
                <TabsList className="h-auto flex-wrap justify-start gap-1 bg-transparent p-0">
                  {TABS.map((t) => (
                    <TabsTrigger
                      key={t.key}
                      value={t.key}
                      className="rounded-full px-2.5 py-1 text-xs font-medium text-zinc-400 hover:bg-ink-700 data-[state=active]:bg-emerald-600 data-[state=active]:text-white data-[state=active]:shadow-none"
                    >
                      {t.label}
                      {hasTabContent(t.key) ? "" : " ·"}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            </div>
            <div className="p-4">
              {tab === "fb_ads_md" ? (
                <AdAnglesPanel
                  campaignId={campaign.id}
                  angles={campaign.fb_ad_angles}
                  legacyMarkdown={campaign.fb_ads_md}
                  bridgePublished={campaign.bridge_published}
                />
              ) : tab === "social_md" ? (
                <SocialPostsPanel
                  campaignId={campaign.id}
                  posts={campaign.social_posts}
                  legacyMarkdown={campaign.social_md}
                  sourceImageUrl={campaign.images_json?.source_images?.[0] ?? null}
                  hasEmbeddedImage={!!campaign.embedded_image_data_url}
                />
              ) : !content ? (
                <p className="py-6 text-center text-sm text-zinc-500">Not generated yet.</p>
              ) : tab === "bridge_html" ? (
                <>
                  <p className="mb-2 text-xs text-zinc-500">
                    Preview only — editing, publishing, split-testing, and adding funnel steps all
                    happen on the{" "}
                    <Link href={`/funnels/${campaign!.id}`} className="underline">
                      funnel's own page
                    </Link>
                    . This preview is interactive — try the opt-in form, leads land on your{" "}
                    <Link href="/contacts" className="underline">
                      Contacts
                    </Link>{" "}
                    page.
                  </p>
                  <iframe
                    srcDoc={content}
                    sandbox="allow-scripts"
                    title="Bridge page preview"
                    className="h-[70vh] w-full rounded-lg border border-ink-700 bg-white"
                  />
                </>
              ) : tab === "hoplinks_txt" ? (
                <pre className="overflow-x-auto rounded-lg bg-ink-800 p-3 text-xs text-emerald-300">
                  {content}
                </pre>
              ) : (
                <>
                  <div
                    className="prose-dark"
                    dangerouslySetInnerHTML={{ __html: marked.parse(content) as string }}
                  />
                  {tab === "email_md" && (
                    <div className="mt-4">
                      <SendEmail campaignId={campaign!.id} defaultBody={content} />
                    </div>
                  )}
                  {tab === "tiktok_md" && (
                    <div className="mt-4">
                      <GenerateVideo
                        campaignId={campaign!.id}
                        productTitle={product.product_title}
                        defaultCaption={product.product_title}
                      />
                    </div>
                  )}
                </>
              )}
            </div>
          </>
        )}
      </Card>

      {campaign && (
        <>
          <PromoteKitDialog
            open={regenOpen}
            onOpenChange={setRegenOpen}
            count={1}
            busy={regenBusy}
            mode="regenerate"
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
            onDone={load}
          />
          <BuildProgressDialog
            open={regenJob !== null}
            onOpenChange={(v) => !v && setRegenJob(null)}
            jobIds={regenJob?.jobIds ?? []}
            titleByJobId={regenJob?.titles ?? {}}
            onAllDone={load}
          />
        </>
      )}
    </main>
  );
}
