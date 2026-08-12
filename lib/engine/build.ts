import { completeJSON, COMPLIANCE_SYSTEM, type UsageContext } from "./anthropic";
import { fetchSalesPage, type ImageCandidate, type BrandStyle } from "./salespage";
import { pickProductImage, fetchImageAsDataUrl } from "./images";
import { renderBridgeHtml, buildHoplink, normalizePageCopy, keywordsOf, type PageBlockTree, type PageCopy, type Network, type TrackingSettings } from "./renderPages";
import { themeFromBrandColors } from "./pageTheme";
import { db } from "./core";
import type { FbAdAngle, SocialPost } from "@/lib/shared";
import { wants, type KitAssetKey, type CountableKitAssetKey } from "@/lib/kitAssets";

// Re-exported so every existing server-side importer keeps working; the list itself is
// isomorphic (see lib/buildStages.ts) because the progress checklist reads it in the browser.
export { BUILD_CAMPAIGN_STAGES, type BuildStage } from "@/lib/buildStages";
import { BUILD_CAMPAIGN_STAGES } from "@/lib/buildStages";

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
    : {
        ok: false,
        text: null,
        imageCandidates: [] as ImageCandidate[],
        brandColors: [] as string[],
        brandStyle: {} as BrandStyle,
      };
  const hoplinks = buildHoplinks(product.network, affiliateId, product.vendor_id, product.hoplink_override);
  return {
    stageData: {
      sales_text: page.text,
      image_candidates: page.imageCandidates,
      page_ok: page.ok,
      brand_colors: page.brandColors,
      brand_style: page.brandStyle,
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

/**
 * Output budget for one stage, from what it was actually asked for.
 *
 * This used to be a flat 3000, which was fine while the counts were constants. It is not fine now
 * that someone can ask for ten of something: the whole stage is a single call returning one JSON
 * object, and running out of output tokens truncates that object mid-string. The result isn't a
 * short kit, it's unparseable JSON — the stage throws, burns its retries, and the job ends as a
 * terminal error having generated nothing. So the budget has to follow the request.
 *
 * The per-item figures are deliberately generous measurements of the existing prompts' output, not
 * tight fits, and the floor keeps small requests behaving exactly as they did before.
 */
function maxTokensFor(items: { perItem: number; count: number }[]): number {
  const BASE = 800; // preamble, JSON structure, and slack
  const CEILING = 8000; // comfortably inside the model's output limit
  const needed = items.reduce((sum, i) => sum + i.perItem * i.count, BASE);
  return Math.min(CEILING, Math.max(3000, needed));
}

async function stageAds(
  product: ProductRow,
  prior: Record<string, unknown>,
  usage: UsageContext,
  assets: KitAssetKey[],
  counts: Record<CountableKitAssetKey, number>
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
  const budget: { perItem: number; count: number }[] = [];
  if (wantFb) {
    properties.fb_ad_angles = {
      type: "array",
      minItems: counts.fb_ads,
      maxItems: counts.fb_ads,
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
      `fb_ad_angles — exactly ${counts.fb_ads} distinct Meta-compliant ad angles for this product, each as a structured object with a headline, primary_text, description, and cta.`
    );
    // A Facebook primary text alone runs to 100-150 words, so this is per-angle headroom rather
    // than a measurement of the average.
    budget.push({ perItem: 280, count: counts.fb_ads });
  }
  if (wantTiktok) {
    properties.tiktok_md = { type: "string" };
    required.push("tiktok_md");
    asks.push(
      `tiktok_md — ${counts.tiktok} short one-line hooks plus ${counts.tiktok} full 30-45s UGC-style video scripts (spoken lines + shot notes) for the same product, as a Markdown string.`
    );
    budget.push({ perItem: 380, count: counts.tiktok });
  }

  const result = await completeJSON<{ fb_ad_angles?: FbAdAngle[]; tiktok_md?: string }>({
    system: COMPLIANCE_SYSTEM,
    prompt: `${ctx}\n\nWrite:\n${asks.map((a, i) => `${i + 1}. ${a}`).join("\n")}`,
    schema: { type: "object", properties, required },
    maxTokens: maxTokensFor(budget),
    usage,
  });
  // Defensive validation — the JSON Schema's minItems/maxItems is the primary enforcement, but a
  // wire hiccup shouldn't be able to write a malformed array; fail the stage (existing
  // retry/attempts-cap machinery handles it) rather than persist bad data.
  if (wantFb && (!Array.isArray(result.fb_ad_angles) || result.fb_ad_angles.length !== counts.fb_ads)) {
    throw new Error(`Model did not return exactly ${counts.fb_ads} ad angles`);
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
    prompt: `${ctx}\n\nWrite bridge (landing) page copy: a headline, a lead paragraph, a "mechanism" explanation (why/how it works), 3-5 benefit bullets, a short proof/credibility paragraph, 3-4 FAQ pairs, and a short CTA button label.

Also plan the search targeting for this offer: one primary keyword a real buyer would type, 3-6 secondary/semantic keywords, and the search intent (informational, commercial or transactional). Base them on the sales page's own language — do not invent volume figures or difficulty scores, which you cannot know.`,
    schema: {
      type: "object",
      properties: {
        headline: { type: "string" },
        keywords: {
          type: "object",
          properties: {
            primary: { type: "string" },
            secondary: { type: "array", items: { type: "string" }, minItems: 3, maxItems: 6 },
            intent: { type: "string" },
          },
          required: ["primary", "secondary", "intent"],
        },
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
  // The plan rides on the tree, like contentWidth and theme — the funnel page, its variants, its
  // steps and the blog post derived from it all read page_copy, so one write covers them.
  const planned = keywordsOf({ keywords: (copy as unknown as { keywords?: unknown }).keywords } as PageBlockTree);
  if (planned) tree.keywords = planned;
  // Theme the page from the product's OWN sales page (stage 0 collected the colours, the heading
  // typeface and the button roundness). The accent drives buttons and links; the reading surfaces
  // are TINTED toward it rather than painted with it, and the tint is re-measured for contrast —
  // see themeFromBrandColors. A rebuild re-derives all of it; a tenant's own edits live on the
  // saved tree and are only replaced when they deliberately rebuild, same as every generated field.
  const brandStyle = (prior.brand_style as BrandStyle | undefined) ?? {};
  const brandTheme = themeFromBrandColors((prior.brand_colors as string[] | undefined) ?? [], {
    headingFont: brandStyle.headingFont,
    buttonShape: brandStyle.buttonShape,
  });
  if (brandTheme) tree.theme = brandTheme;
  // A REBUILD of a campaign whose funnel already has tracking settings must keep its snippets —
  // fresh builds just read null here (the column defaults to null until funnel settings set it).
  const { data: trackingRow } = await db.from("campaigns").select("tracking").eq("id", campaignId).maybeSingle();
  const tracking = (trackingRow?.tracking ?? null) as TrackingSettings | null;
  const bridgeHtml = renderBridgeHtml(product, tree, hoplink, imageDataUrl, campaignId, null, tracking);

  return {
    // Carried forward so the blog stage can write TO the plan rather than inventing its own
    // targeting — planning first and then writing is the whole point of doing it in this order.
    stageData: { ...prior, keywords: planned },
    campaignPatch: {
      bridge_html: bridgeHtml,
      page_copy: tree,
      embedded_image_data_url: imageDataUrl,
    },
  };
}

/**
 * The affiliate link in a blog article is CODE-OWNED, exactly like the funnel page's hoplink.
 *
 * The model is asked to place `{{OFFER_LINK}}` as the link target and is told never to write a
 * real URL — then this substitutes the tracked link. Letting an LLM type the hoplink itself is how
 * you ship an article whose links 404, point at the vendor with no affiliate id, or carry a
 * hallucinated tid; content rule 4 already says hoplinks are built by buildHoplink and nothing
 * else, and "nothing else" includes the model.
 *
 * **`blog_md` was shipping with no offer link at all** until this existed — the prompt mentioned
 * the "tid=blog" channel but the link was never passed in and nothing post-processed the markdown,
 * so all 13 articles generated before this were unmonetized. Measured, not assumed.
 */
export const OFFER_LINK_TOKEN = "{{OFFER_LINK}}";

export function withOfferLinks(markdown: string, hoplink: string | null): string {
  const body = typeof markdown === "string" ? markdown : "";

  // No product (a standalone funnel has none) means no link to substitute. Strip the placeholder
  // rather than publishing "{{OFFER_LINK}}" to readers, and drop the now-targetless markdown link
  // back to plain text so the sentence still reads.
  if (!hoplink) {
    return body
      .replace(new RegExp(`\\[([^\\]]*)\\]\\(\\s*${escapeRegExp(OFFER_LINK_TOKEN)}\\s*\\)`, "g"), "$1")
      .split(OFFER_LINK_TOKEN)
      .join("");
  }

  const substituted = body.split(OFFER_LINK_TOKEN).join(hoplink);

  // The model ignoring the instruction is the failure this whole function exists to prevent, so
  // don't just hope: if nothing was substituted, append a code-owned CTA. A plain line at the end
  // is worse placement than an in-body link but infinitely better than an article that earns
  // nothing, and it is the same "guarantee the compliance-critical bit" habit as DISCLOSURE.
  if (substituted === body) {
    const cta = `\n\n[Check the official page for current pricing and availability](${hoplink})\n`;
    return `${body.trimEnd()}\n${cta}`;
  }
  return substituted;
}

function escapeRegExp(v: string): string {
  return v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function stageContent(
  product: ProductRow,
  prior: Record<string, unknown>,
  usage: UsageContext
): Promise<StageOutput> {
  const ctx = productContext(product, (prior.sales_text as string | null) ?? null);
  const planned = (prior.keywords ?? null) as { primary: string; secondary: string[]; intent?: string } | null;
  const keywordBrief = planned
    ? `\n\nWrite this article to rank for the primary keyword "${planned.primary}"${
        planned.intent ? ` (search intent: ${planned.intent})` : ""
      }. Work these related terms in where they read naturally: ${planned.secondary.join(", ")}. Use them like a writer, not a keyword tool — the primary phrase belongs in the title and once early in the body, and anything that reads like padding is worse than omitting it.`
    : "";
  const byChannel = (prior.hoplink_by_channel ?? {}) as Record<string, string>;
  const blogHoplink = typeof byChannel.blog === "string" && byChannel.blog ? byChannel.blog : null;

  const result = await completeJSON<{ blog_md: string }>({
    system: COMPLIANCE_SYSTEM,
    prompt: `${ctx}${keywordBrief}\n\nWrite a 1200-1800 word SEO-style blog article about this niche/product for the "tid=blog" traffic channel, in Markdown, with a clear intro/body/conclusion, natural keyword usage, and an affiliate disclosure line near the top or bottom.

Link to the offer 2-3 times where it reads naturally — once early, once in the body, once in the conclusion — as Markdown links whose target is exactly the placeholder ${OFFER_LINK_TOKEN}, e.g. "[see the full programme](${OFFER_LINK_TOKEN})". Never write a real URL, a domain, or any other link target: the placeholder is substituted for the reader's tracked affiliate link afterwards, and anything else you invent would not track and may not resolve.`,
    schema: {
      type: "object",
      properties: { blog_md: { type: "string" } },
      required: ["blog_md"],
    },
    maxTokens: 6000,
    usage,
  });

  return { stageData: prior, campaignPatch: { blog_md: withOfferLinks(result.blog_md, blogHoplink) } };
}

async function stageSocial(
  product: ProductRow,
  prior: Record<string, unknown>,
  usage: UsageContext,
  assets: KitAssetKey[],
  counts: Record<CountableKitAssetKey, number>
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
  const budget: { perItem: number; count: number }[] = [];
  if (wantSocial) {
    properties.social_posts = {
      type: "array",
      minItems: counts.social,
      maxItems: counts.social,
      items: { type: "object", properties: { caption: { type: "string" } }, required: ["caption"] },
    };
    required.push("social_posts");
    asks.push(
      `social_posts — exactly ${counts.social} short organic social captions for this product/niche, each as a structured object with a caption field.`
    );
    budget.push({ perItem: 120, count: counts.social });
  }
  if (wantEmail) {
    properties.email_md = { type: "string" };
    required.push("email_md");
    asks.push(
      `email_md — a ${counts.email}-email swipe sequence (subject + body each) for the "tid=email" channel, as a Markdown string.`
    );
    budget.push({ perItem: 450, count: counts.email });
  }

  const result = await completeJSON<{ social_posts?: SocialPost[]; email_md?: string }>({
    system: COMPLIANCE_SYSTEM,
    prompt: `${ctx}\n\nWrite:\n${asks.map((a, i) => `${i + 1}. ${a}`).join("\n")}`,
    schema: { type: "object", properties, required },
    maxTokens: maxTokensFor(budget),
    usage,
  });
  if (wantSocial && (!Array.isArray(result.social_posts) || result.social_posts.length !== counts.social)) {
    throw new Error(`Model did not return exactly ${counts.social} social posts`);
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
  assets: KitAssetKey[],
  counts: Record<CountableKitAssetKey, number>
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
      return stageAds(product, priorStageData, usage, assets, counts);
    case "pages":
      return wants(assets, "funnel")
        ? stagePages(product, priorStageData, usage, campaignId)
        : { stageData: priorStageData };
    case "content":
      return wants(assets, "blog")
        ? stageContent(product, priorStageData, usage)
        : { stageData: priorStageData };
    case "social":
      return stageSocial(product, priorStageData, usage, assets, counts);
    default:
      throw new Error(`Unknown build_campaign stage index ${stageIndex}`);
  }
}
