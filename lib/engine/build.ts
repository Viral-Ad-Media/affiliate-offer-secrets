import { completeJSON, COMPLIANCE_SYSTEM, type UsageContext } from "./anthropic";
import { fetchSalesPage, type ImageCandidate } from "./salespage";
import { pickProductImage, fetchImageAsDataUrl } from "./images";
import { renderBridgeHtml, buildHoplink, normalizePageCopy, type PageCopy, type Network, type TrackingSettings } from "./renderPages";
import { db } from "./core";
import type { FbAdAngle, SocialPost } from "@/lib/shared";
import { wants, type KitAssetKey } from "@/lib/kitAssets";

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
  // Tenant-supplied link that replaces the derived one (0064). Null for every product until
  // someone sets it; the worker reads the row with select("*"), so nothing else had to change to
  // make it available here.
  hoplink_override: string | null;
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

function buildHoplinks(network: Network, affiliateId: string, vendorId: string, override?: string | null) {
  const tids = ["fb", "tt", "blog", "email", "page"] as const;
  // With an override set every channel resolves to the same URL — see buildHoplink. The per-channel
  // map is still built so downstream shapes are unchanged, it just stops being per-channel.
  const link = (tid: string) => buildHoplink(network, affiliateId, vendorId, tid, override);
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
  const hoplinks = buildHoplinks(product.network, affiliateId, product.vendor_id, product.hoplink_override);
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
  usage: UsageContext,
  assets: KitAssetKey[]
): Promise<StageOutput> {
  // One Anthropic call produced BOTH Facebook angles and TikTok scripts, which is why dropping one
  // of them needs the schema and prompt built from the selection rather than the whole stage
  // skipped. Asking for only what was chosen is also what makes the saving real — a combined call
  // that generated TikTok scripts and then discarded them would cost exactly the same.
  const wantFb = wants(assets, "fb_ads");
  const wantTiktok = wants(assets, "tiktok");
  if (!wantFb && !wantTiktok) return { stageData: prior };

  const ctx = productContext(product, (prior.sales_text as string | null) ?? null);

  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  const asks: string[] = [];
  if (wantFb) {
    properties.fb_ad_angles = {
      type: "array",
      minItems: 3,
      maxItems: 3,
      items: {
        type: "object",
        properties: {
          headline: { type: "string" },
          primary_text: { type: "string" },
          description: { type: "string" },
          cta: { type: "string" },
        },
        required: ["headline", "primary_text", "description", "cta"],
      },
    };
    required.push("fb_ad_angles");
    asks.push(
      "fb_ad_angles — exactly 3 distinct Meta-compliant ad angles for this product, each as a structured object with a headline, primary_text, description, and cta."
    );
  }
  if (wantTiktok) {
    properties.tiktok_md = { type: "string" };
    required.push("tiktok_md");
    asks.push(
      "tiktok_md — 3 short one-line hooks plus 3 full 30-45s UGC-style video scripts (spoken lines + shot notes) for the same product, as a Markdown string."
    );
  }

  const result = await completeJSON<{ fb_ad_angles?: FbAdAngle[]; tiktok_md?: string }>({
    system: COMPLIANCE_SYSTEM,
    prompt: `${ctx}\n\nWrite:\n${asks.map((a, i) => `${i + 1}. ${a}`).join("\n")}`,
    schema: { type: "object", properties, required },
    maxTokens: 3000,
    usage,
  });
  // Defensive validation — the JSON Schema's minItems/maxItems is the primary enforcement, but a
  // wire hiccup shouldn't be able to write a malformed array; fail the stage (existing
  // retry/attempts-cap machinery handles it) rather than persist bad data.
  if (wantFb && (!Array.isArray(result.fb_ad_angles) || result.fb_ad_angles.length !== 3)) {
    throw new Error("Model did not return exactly 3 ad angles");
  }
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
    prompt: `${ctx}\n\nWrite bridge (landing) page copy: a headline, a lead paragraph, a "mechanism" explanation (why/how it works), 3-5 benefit bullets, a short proof/credibility paragraph, 3-4 FAQ pairs, and a short CTA button label.`,
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
      },
      required: ["headline", "lead", "mechanism", "benefits", "proof", "faq", "cta"],
    },
    maxTokens: 3000,
    usage,
  });

  const byChannel = (prior.hoplink_by_channel as Record<string, string>) ?? {};
  const imageDataUrl = (prior.image_data_url as string | null) ?? null;
  const hoplink = byChannel.page ?? product.hoplink ?? "#";
  // The Anthropic structured-output schema above stays the permanent flat authoring shape (see
  // lib/engine/renderPages.ts's header comment) — normalize it into a block tree once here so
  // every newly-built campaign persists version-2 page_copy going forward, rather than relying on
  // renderBridgeHtml's own internal (idempotent) normalization at every future read.
  const tree = normalizePageCopy(copy, imageDataUrl);
  // A REBUILD of a campaign whose funnel already has tracking settings must keep its snippets —
  // fresh builds just read null here (the column defaults to null until funnel settings set it).
  const { data: trackingRow } = await db.from("campaigns").select("tracking").eq("id", campaignId).maybeSingle();
  const tracking = (trackingRow?.tracking ?? null) as TrackingSettings | null;
  const bridgeHtml = renderBridgeHtml(product, tree, hoplink, imageDataUrl, campaignId, null, tracking);

  return {
    stageData: prior,
    campaignPatch: {
      bridge_html: bridgeHtml,
      page_copy: tree,
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
  usage: UsageContext,
  assets: KitAssetKey[]
): Promise<StageOutput> {
  // Same combined-call shape as stageAds — organic captions and the email sequence came from one
  // request, so choosing one of them means narrowing the schema, not skipping the stage.
  const wantSocial = wants(assets, "social");
  const wantEmail = wants(assets, "email");
  if (!wantSocial && !wantEmail) return { stageData: prior };

  const ctx = productContext(product, (prior.sales_text as string | null) ?? null);

  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  const asks: string[] = [];
  if (wantSocial) {
    properties.social_posts = {
      type: "array",
      minItems: 5,
      maxItems: 5,
      items: { type: "object", properties: { caption: { type: "string" } }, required: ["caption"] },
    };
    required.push("social_posts");
    asks.push(
      "social_posts — exactly 5 short organic social captions for this product/niche, each as a structured object with a caption field."
    );
  }
  if (wantEmail) {
    properties.email_md = { type: "string" };
    required.push("email_md");
    asks.push(
      'email_md — a 3-email swipe sequence (subject + body each) for the "tid=email" channel, as a Markdown string.'
    );
  }

  const result = await completeJSON<{ social_posts?: SocialPost[]; email_md?: string }>({
    system: COMPLIANCE_SYSTEM,
    prompt: `${ctx}\n\nWrite:\n${asks.map((a, i) => `${i + 1}. ${a}`).join("\n")}`,
    schema: { type: "object", properties, required },
    maxTokens: 3000,
    usage,
  });
  if (wantSocial && (!Array.isArray(result.social_posts) || result.social_posts.length !== 5)) {
    throw new Error("Model did not return exactly 5 social posts");
  }
  return { stageData: prior, campaignPatch: result };
}

export async function runBuildCampaignStage(
  stageIndex: number,
  product: ProductRow,
  affiliateId: string,
  priorStageData: Record<string, unknown>,
  usageCtx: { userId: string; jobId: string },
  campaignId: string,
  assets: KitAssetKey[]
): Promise<StageOutput> {
  const stage = BUILD_CAMPAIGN_STAGES[stageIndex];
  const usage: UsageContext = { ...usageCtx, jobType: "build_campaign", stage };
  switch (stage) {
    case "context":
      // Always runs. It fetches the sales page and builds the hoplinks — every other stage reads
      // its output, and the hoplinks are the product's tracking links regardless of what else was
      // asked for. It also makes no Anthropic call, so there is nothing to save by skipping it.
      return stageContext(product, affiliateId);
    case "image":
      // The picked product image is only ever embedded into the bridge page, so with no funnel
      // there is nothing to embed it in — and this stage DOES make an Anthropic call to choose
      // between candidates, so skipping is a real saving rather than bookkeeping.
      return wants(assets, "funnel")
        ? stageImage(product, priorStageData, usage)
        : { stageData: priorStageData };
    case "ads":
      return stageAds(product, priorStageData, usage, assets);
    case "pages":
      return wants(assets, "funnel")
        ? stagePages(product, priorStageData, usage, campaignId)
        : { stageData: priorStageData };
    case "content":
      return wants(assets, "blog")
        ? stageContent(product, priorStageData, usage)
        : { stageData: priorStageData };
    case "social":
      return stageSocial(product, priorStageData, usage, assets);
    default:
      throw new Error(`Unknown build_campaign stage index ${stageIndex}`);
  }
}
