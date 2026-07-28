import { completeJSON, COMPLIANCE_SYSTEM, type UsageContext } from "./anthropic";
import { fetchSalesPage, type ImageCandidate } from "./salespage";
import { pickProductImage, fetchImageAsDataUrl } from "./images";
import { renderPresellHtml, renderBridgeHtml, buildHoplink, type PageCopy, type Network } from "./renderPages";

export const BUILD_CAMPAIGN_STAGES = ["context", "image", "ads", "pages", "content", "social"] as const;
export type BuildStage = (typeof BUILD_CAMPAIGN_STAGES)[number];

export type ProductRow = {
  id: string;
  network: Network;
  vendor_id: string;
  product_title: string;
  description: string | null;
  niche: string;
  gravity: number | null;
  avg_sale: number | null;
  initial_sale: number | null;
  recurring: number | null;
  sales_page_url: string | null;
  hoplink: string | null;
};

export type StageOutput = {
  stageData: Record<string, unknown>;
  campaignPatch?: Record<string, unknown>;
};

function productContext(product: ProductRow, salesText: string | null): string {
  return [
    `Title: ${product.product_title}`,
    `Niche: ${product.niche}`,
    product.description ? `Description: ${product.description}` : null,
    product.gravity != null ? `Gravity: ${product.gravity}` : null,
    product.avg_sale != null ? `Avg $/sale: $${product.avg_sale}` : null,
    product.recurring ? `Rebill: $${product.recurring}` : null,
    salesText
      ? `\nSales page excerpt:\n${salesText.slice(0, 6000)}`
      : "\n(Sales page could not be fetched — write conservatively, do not invent specifics.)",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildHoplinks(network: Network, affiliateId: string, vendorId: string) {
  const tids = ["fb", "tt", "blog", "email", "page"] as const;
  const link = (tid: string) => buildHoplink(network, affiliateId, vendorId, tid);
  const byChannel = Object.fromEntries(tids.map((t) => [t, link(t)])) as Record<
    (typeof tids)[number],
    string
  >;
  const text = tids.map((t) => `${t}: ${link(t)}`).join("\n");
  return { text, byChannel };
}

async function stageContext(product: ProductRow, affiliateId: string): Promise<StageOutput> {
  const page = product.sales_page_url
    ? await fetchSalesPage(product.sales_page_url)
    : { ok: false, text: null, imageCandidates: [] as ImageCandidate[] };
  const hoplinks = buildHoplinks(product.network, affiliateId, product.vendor_id);
  return {
    stageData: {
      sales_text: page.text,
      image_candidates: page.imageCandidates,
      page_ok: page.ok,
      hoplink_by_channel: hoplinks.byChannel,
    },
    campaignPatch: { hoplinks_txt: hoplinks.text },
  };
}

async function stageImage(
  _product: ProductRow,
  prior: Record<string, unknown>,
  usage: UsageContext
): Promise<StageOutput> {
  const candidates = (prior.image_candidates as ImageCandidate[]) ?? [];
  const picked =
    candidates.length > 0 ? await pickProductImage(candidates, _product.product_title, usage) : null;
  const dataUrl = picked ? await fetchImageAsDataUrl(picked.url) : null;
  return {
    stageData: { ...prior, image_data_url: dataUrl },
    campaignPatch: { images_json: { source_images: picked ? [picked.url] : [] } },
  };
}

async function stageAds(
  product: ProductRow,
  prior: Record<string, unknown>,
  usage: UsageContext
): Promise<StageOutput> {
  const ctx = productContext(product, (prior.sales_text as string | null) ?? null);
  const result = await completeJSON<{ fb_ads_md: string; tiktok_md: string }>({
    system: COMPLIANCE_SYSTEM,
    prompt: `${ctx}\n\nWrite:\n1. fb_ads_md — 3 distinct Meta-compliant ad angles for this product, each with clearly labeled Primary Text, Headline, Description, and CTA.\n2. tiktok_md — 3 short one-line hooks plus 3 full 30-45s UGC-style video scripts (spoken lines + shot notes) for the same product.\n\nReturn both as Markdown strings.`,
    schema: {
      type: "object",
      properties: {
        fb_ads_md: { type: "string" },
        tiktok_md: { type: "string" },
      },
      required: ["fb_ads_md", "tiktok_md"],
    },
    maxTokens: 3000,
    usage,
  });
  return { stageData: prior, campaignPatch: result };
}

async function stagePages(
  product: ProductRow,
  prior: Record<string, unknown>,
  usage: UsageContext,
  campaignId: string
): Promise<StageOutput> {
  const ctx = productContext(product, (prior.sales_text as string | null) ?? null);
  const copy = await completeJSON<PageCopy>({
    system: COMPLIANCE_SYSTEM,
    prompt: `${ctx}\n\nWrite presell/landing page copy: a headline, a lead paragraph, a "mechanism" explanation (why/how it works), 3-5 benefit bullets, a short proof/credibility paragraph, 3-4 FAQ pairs, and a short CTA button label. Also return the same material as one cohesive landing_md markdown document with headline/lead/mechanism/benefits/proof/FAQ/CTA sections in that order.`,
    schema: {
      type: "object",
      properties: {
        headline: { type: "string" },
        lead: { type: "string" },
        mechanism: { type: "string" },
        benefits: { type: "array", items: { type: "string" } },
        proof: { type: "string" },
        faq: {
          type: "array",
          items: {
            type: "object",
            properties: { q: { type: "string" }, a: { type: "string" } },
            required: ["q", "a"],
          },
        },
        cta: { type: "string" },
        landing_md: { type: "string" },
      },
      required: ["headline", "lead", "mechanism", "benefits", "proof", "faq", "cta", "landing_md"],
    },
    maxTokens: 3000,
    usage,
  });

  const byChannel = (prior.hoplink_by_channel as Record<string, string>) ?? {};
  const imageDataUrl = (prior.image_data_url as string | null) ?? null;
  const hoplink = byChannel.page ?? product.hoplink ?? "#";
  const presellHtml = renderPresellHtml(product, copy, hoplink, imageDataUrl);
  const bridgeHtml = renderBridgeHtml(product, copy, hoplink, imageDataUrl, campaignId);

  return {
    stageData: prior,
    campaignPatch: {
      landing_md: copy.landing_md,
      presell_html: presellHtml,
      bridge_html: bridgeHtml,
      page_copy: copy,
      embedded_image_data_url: imageDataUrl,
    },
  };
}

async function stageContent(
  product: ProductRow,
  prior: Record<string, unknown>,
  usage: UsageContext
): Promise<StageOutput> {
  const ctx = productContext(product, (prior.sales_text as string | null) ?? null);
  const result = await completeJSON<{ blog_md: string }>({
    system: COMPLIANCE_SYSTEM,
    prompt: `${ctx}\n\nWrite a 1200-1800 word SEO-style blog article about this niche/product for the "tid=blog" traffic channel, in Markdown, with a clear intro/body/conclusion, natural keyword usage, and an affiliate disclosure line near the top or bottom.`,
    schema: {
      type: "object",
      properties: { blog_md: { type: "string" } },
      required: ["blog_md"],
    },
    maxTokens: 6000,
    usage,
  });
  return { stageData: prior, campaignPatch: result };
}

async function stageSocial(
  product: ProductRow,
  prior: Record<string, unknown>,
  usage: UsageContext
): Promise<StageOutput> {
  const ctx = productContext(product, (prior.sales_text as string | null) ?? null);
  const result = await completeJSON<{ social_md: string; email_md: string }>({
    system: COMPLIANCE_SYSTEM,
    prompt: `${ctx}\n\nWrite:\n1. social_md — 5 short organic social captions for this product/niche.\n2. email_md — a 3-email swipe sequence (subject + body each) for the "tid=email" channel.\n\nReturn both as Markdown strings.`,
    schema: {
      type: "object",
      properties: {
        social_md: { type: "string" },
        email_md: { type: "string" },
      },
      required: ["social_md", "email_md"],
    },
    maxTokens: 3000,
    usage,
  });
  return { stageData: prior, campaignPatch: result };
}

export async function runBuildCampaignStage(
  stageIndex: number,
  product: ProductRow,
  affiliateId: string,
  priorStageData: Record<string, unknown>,
  usageCtx: { userId: string; jobId: string },
  campaignId: string
): Promise<StageOutput> {
  const stage = BUILD_CAMPAIGN_STAGES[stageIndex];
  const usage: UsageContext = { ...usageCtx, jobType: "build_campaign", stage };
  switch (stage) {
    case "context":
      return stageContext(product, affiliateId);
    case "image":
      return stageImage(product, priorStageData, usage);
    case "ads":
      return stageAds(product, priorStageData, usage);
    case "pages":
      return stagePages(product, priorStageData, usage, campaignId);
    case "content":
      return stageContent(product, priorStageData, usage);
    case "social":
      return stageSocial(product, priorStageData, usage);
    default:
      throw new Error(`Unknown build_campaign stage index ${stageIndex}`);
  }
}
