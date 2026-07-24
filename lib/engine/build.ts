import { completeJSON, COMPLIANCE_SYSTEM, type UsageContext } from "./anthropic";
import { fetchSalesPage, type ImageCandidate } from "./salespage";
import { pickProductImage, fetchImageAsDataUrl } from "./images";

export const BUILD_CAMPAIGN_STAGES = ["context", "image", "ads", "pages", "content", "social"] as const;
export type BuildStage = (typeof BUILD_CAMPAIGN_STAGES)[number];

export type ProductRow = {
  id: string;
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

const DISCLOSURE =
  "This page contains affiliate links. If you purchase through them, I may earn a commission at no extra cost to you.";

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

function buildHoplinks(nickname: string, vendorId: string) {
  const tids = ["fb", "tt", "blog", "email", "page"] as const;
  const link = (tid: string) => `https://hop.clickbank.net/?affiliate=${nickname}&vendor=${vendorId}&tid=${tid}`;
  const byChannel = Object.fromEntries(tids.map((t) => [t, link(t)])) as Record<
    (typeof tids)[number],
    string
  >;
  const text = tids.map((t) => `${t}: ${link(t)}`).join("\n");
  return { text, byChannel };
}

function escapeHtml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

type PageCopy = {
  headline: string;
  lead: string;
  mechanism: string;
  benefits: string[];
  proof: string;
  faq: { q: string; a: string }[];
  cta: string;
  landing_md: string;
};

function renderPresellHtml(
  product: ProductRow,
  copy: PageCopy,
  hoplink: string,
  imageDataUrl: string | null
): string {
  const benefits = copy.benefits.map((b) => `<li>${escapeHtml(b)}</li>`).join("");
  const faq = copy.faq
    .map((f) => `<div class="faq-item"><h3>${escapeHtml(f.q)}</h3><p>${escapeHtml(f.a)}</p></div>`)
    .join("");
  const imageBlock = imageDataUrl
    ? `<img src="${imageDataUrl}" alt="${escapeHtml(product.product_title)}" style="max-width:100%;border-radius:12px;margin:24px 0;" />`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(copy.headline)}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; background:#fafafa; color:#1a1a1a; margin:0; padding:0; line-height:1.6; }
  .wrap { max-width: 680px; margin: 0 auto; padding: 40px 20px 80px; }
  h1 { font-size: 32px; line-height:1.2; margin-bottom: 16px; }
  h2 { font-size: 22px; margin-top: 32px; }
  .lead { font-size: 18px; color:#333; }
  .cta { display:inline-block; background:#16a34a; color:#fff; text-decoration:none; padding:16px 32px; border-radius:8px; font-weight:600; font-size:18px; margin: 24px 0; }
  .cta:hover { background:#15803d; }
  ul { padding-left: 20px; }
  .faq-item { margin-bottom: 16px; }
  .faq-item h3 { font-size:16px; margin-bottom:4px; }
  .disclosure { margin-top: 48px; padding-top: 24px; border-top: 1px solid #e5e5e5; font-size: 12px; color: #888; }
</style>
</head>
<body>
  <div class="wrap">
    <h1>${escapeHtml(copy.headline)}</h1>
    <p class="lead">${escapeHtml(copy.lead)}</p>
    ${imageBlock}
    <h2>How it works</h2>
    <p>${escapeHtml(copy.mechanism)}</p>
    <h2>What you get</h2>
    <ul>${benefits}</ul>
    <p>${escapeHtml(copy.proof)}</p>
    <a class="cta" href="${hoplink}">${escapeHtml(copy.cta)}</a>
    <h2>Questions</h2>
    ${faq}
    <a class="cta" href="${hoplink}">${escapeHtml(copy.cta)}</a>
    <p class="disclosure">${DISCLOSURE}</p>
  </div>
</body>
</html>`;
}

function renderBridgeHtml(
  product: ProductRow,
  copy: PageCopy,
  hoplink: string,
  imageDataUrl: string | null
): string {
  const imageBlock = imageDataUrl
    ? `<img src="${imageDataUrl}" alt="${escapeHtml(product.product_title)}" style="max-width:100%;border-radius:12px;margin:24px 0;" />`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(copy.headline)}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; background:#fafafa; color:#1a1a1a; margin:0; padding:0; line-height:1.6; }
  .wrap { max-width: 560px; margin: 0 auto; padding: 40px 20px 80px; text-align:center; }
  h1 { font-size: 28px; line-height:1.25; }
  .lead { font-size: 17px; color:#333; }
  input { width:100%; box-sizing:border-box; padding:14px; margin:8px 0; border:1px solid #ccc; border-radius:8px; font-size:16px; }
  .cta { display:inline-block; background:#16a34a; color:#fff; border:none; padding:16px 32px; border-radius:8px; font-weight:600; font-size:18px; margin-top: 12px; cursor:pointer; width:100%; text-decoration:none; }
  .cta:hover { background:#15803d; }
  .hidden { display:none; }
  .disclosure { margin-top: 48px; padding-top: 24px; border-top: 1px solid #e5e5e5; font-size: 12px; color: #888; text-align:left; }
</style>
</head>
<body>
  <div class="wrap">
    <div id="step1">
      <h1>${escapeHtml(copy.headline)}</h1>
      <p class="lead">${escapeHtml(copy.lead)}</p>
      ${imageBlock}
      <!-- LEAD_CAPTURE_ENDPOINT: no lead-storage backend is wired up yet. Wire this form to your own API, ESP, or ClickBank Studio's own DB before sending paid traffic here. -->
      <form id="leadForm">
        <input type="text" placeholder="First name" required />
        <input type="email" placeholder="Email address" required />
        <button type="submit" class="cta">${escapeHtml(copy.cta)}</button>
      </form>
    </div>
    <div id="step2" class="hidden">
      <h1>${escapeHtml(copy.headline)}</h1>
      <p class="lead">${escapeHtml(copy.mechanism)}</p>
      <a class="cta" href="${hoplink}">${escapeHtml(copy.cta)}</a>
    </div>
    <p class="disclosure">${DISCLOSURE}</p>
  </div>
  <script>
    document.getElementById('leadForm').addEventListener('submit', function (e) {
      e.preventDefault();
      // Placeholder only — see the LEAD_CAPTURE_ENDPOINT marker above. This does not save the lead anywhere.
      document.getElementById('step1').classList.add('hidden');
      document.getElementById('step2').classList.remove('hidden');
    });
  </script>
</body>
</html>`;
}

async function stageContext(product: ProductRow, nickname: string): Promise<StageOutput> {
  const page = product.sales_page_url
    ? await fetchSalesPage(product.sales_page_url)
    : { ok: false, text: null, imageCandidates: [] as ImageCandidate[] };
  const hoplinks = buildHoplinks(nickname, product.vendor_id);
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
  usage: UsageContext
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
  const bridgeHtml = renderBridgeHtml(product, copy, hoplink, imageDataUrl);

  return {
    stageData: prior,
    campaignPatch: { landing_md: copy.landing_md, presell_html: presellHtml, bridge_html: bridgeHtml },
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
  nickname: string,
  priorStageData: Record<string, unknown>,
  usageCtx: { userId: string; jobId: string }
): Promise<StageOutput> {
  const stage = BUILD_CAMPAIGN_STAGES[stageIndex];
  const usage: UsageContext = { ...usageCtx, jobType: "build_campaign", stage };
  switch (stage) {
    case "context":
      return stageContext(product, nickname);
    case "image":
      return stageImage(product, priorStageData, usage);
    case "ads":
      return stageAds(product, priorStageData, usage);
    case "pages":
      return stagePages(product, priorStageData, usage);
    case "content":
      return stageContent(product, priorStageData, usage);
    case "social":
      return stageSocial(product, priorStageData, usage);
    default:
      throw new Error(`Unknown build_campaign stage index ${stageIndex}`);
  }
}
