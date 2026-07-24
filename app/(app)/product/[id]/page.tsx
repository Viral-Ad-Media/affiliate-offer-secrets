"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { marked } from "marked";
import { ArrowLeft, Copy, CheckCircle2, ExternalLink, Download } from "lucide-react";
import type { Campaign, Product } from "@/lib/shared";
import { STATUS_COLORS } from "@/lib/shared";
import PostToFacebook from "@/components/PostToFacebook";
import LaunchAd from "@/components/LaunchAd";

const TABS = [
  { key: "fb_ads_md", label: "FB/IG Ads" },
  { key: "tiktok_md", label: "TikTok" },
  { key: "landing_md", label: "Landing copy" },
  { key: "presell_html", label: "Presell page" },
  { key: "bridge_html", label: "Bridge (lead capture)" },
  { key: "blog_md", label: "Blog" },
  { key: "social_md", label: "Social" },
  { key: "email_md", label: "Emails" },
  { key: "hoplinks_txt", label: "Hoplinks" },
] as const;

export default function ProductPage({ params }: { params: { id: string } }) {
  const [product, setProduct] = useState<Product | null>(null);
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("fb_ads_md");
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

  function copyHoplink() {
    if (!product?.hoplink) return;
    navigator.clipboard.writeText(product.hoplink);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function downloadHtml(kind: "presell" | "bridge") {
    const html = kind === "presell" ? campaign?.presell_html : campaign?.bridge_html;
    if (!html) return;
    const blob = new Blob([html], { type: "text/html" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${product!.vendor_id}-${kind}.html`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <main className="space-y-5">
      <Link
        href="/dashboard"
        className="inline-flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-200"
      >
        <ArrowLeft className="h-4 w-4" /> Back to dashboard
      </Link>

      <header className="card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-zinc-100">{product.product_title}</h1>
            <p className="mt-1 text-sm text-zinc-400">
              {product.vendor_id} · {product.niche}
            </p>
          </div>
          <span className={`chip ${STATUS_COLORS[product.status]}`}>{product.status}</span>
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
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button onClick={copyHoplink} className="btn-primary">
            {copied ? <CheckCircle2 className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            Copy hoplink
          </button>
          {product.sales_page_url && (
            <a href={product.sales_page_url} target="_blank" rel="noreferrer" className="btn-ghost">
              <ExternalLink className="h-4 w-4" /> Sales page
            </a>
          )}
          {product.affiliate_page_url && (
            <a href={product.affiliate_page_url} target="_blank" rel="noreferrer" className="btn-ghost">
              <ExternalLink className="h-4 w-4" /> Affiliate tools
            </a>
          )}
          {product.assets_link && (
            <a href={product.assets_link} target="_blank" rel="noreferrer" className="btn-ghost">
              <ExternalLink className="h-4 w-4" /> Drive folder
            </a>
          )}
        </div>
      </header>

      <section className="card">
        <div className="flex items-center justify-between border-b border-ink-700 px-4 py-3">
          <h2 className="text-sm font-semibold text-zinc-100">
            Campaign kit{" "}
            {campaign ? (
              <span
                className={`ml-2 chip ${
                  campaign.status === "ready"
                    ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-300"
                    : campaign.status === "error"
                      ? "border-red-500/30 bg-red-500/15 text-red-300"
                      : "border-sky-500/30 bg-sky-500/15 text-sky-300"
                }`}
              >
                {campaign.status}
              </span>
            ) : null}
          </h2>
          {tab === "presell_html" && campaign?.presell_html && (
            <button onClick={() => downloadHtml("presell")} className="btn-ghost !py-1 text-xs">
              <Download className="h-3.5 w-3.5" /> Download HTML
            </button>
          )}
          {tab === "bridge_html" && campaign?.bridge_html && (
            <button onClick={() => downloadHtml("bridge")} className="btn-ghost !py-1 text-xs">
              <Download className="h-3.5 w-3.5" /> Download HTML
            </button>
          )}
        </div>

        {!campaign ? (
          <p className="px-4 py-10 text-center text-sm text-zinc-500">
            No campaign kit yet. Hit <strong>Promote</strong> on the dashboard to queue one — it
            builds automatically.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap gap-1 border-b border-ink-700 px-4 py-2 text-xs">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={`rounded-full px-2.5 py-1 ${
                    tab === t.key ? "bg-emerald-600 text-white" : "text-zinc-400 hover:bg-ink-700"
                  }`}
                >
                  {t.label}
                  {(campaign as any)[t.key] ? "" : " ·"}
                </button>
              ))}
            </div>
            <div className="p-4">
              {!content ? (
                <p className="py-6 text-center text-sm text-zinc-500">Not generated yet.</p>
              ) : tab === "presell_html" ? (
                <iframe
                  srcDoc={content}
                  sandbox=""
                  title="Presell preview"
                  className="h-[70vh] w-full rounded-lg border border-ink-700 bg-white"
                />
              ) : tab === "bridge_html" ? (
                <>
                  <p className="mb-2 text-xs text-zinc-500">
                    Preview is interactive (try the form) — the submit handler is a placeholder
                    until you wire up real lead storage. See the ⚠ note inside the page.
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
                  {tab === "social_md" && (
                    <div className="mt-4">
                      <PostToFacebook
                        campaignId={campaign!.id}
                        defaultMessage={content}
                        imageUrl={campaign?.images_json?.source_images?.[0] ?? null}
                      />
                    </div>
                  )}
                  {tab === "fb_ads_md" && campaign?.presell_html && (
                    <div className="mt-4">
                      <LaunchAd
                        campaignId={campaign!.id}
                        defaultHeadline={product.product_title}
                        defaultPrimaryText=""
                        destination="presell"
                      />
                    </div>
                  )}
                </>
              )}
            </div>
          </>
        )}
      </section>
    </main>
  );
}
