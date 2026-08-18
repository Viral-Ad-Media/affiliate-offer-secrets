import { completeJSON, COMPLIANCE_SYSTEM, type UsageContext } from "./anthropic";
import { fetchSalesPage, type ImageCandidate, type BrandStyle } from "./salespage";
import { pickProductImages, fetchImagesWithBudget } from "./images";
import { renderBridgeHtml, affiliateLink, normalizePageCopy, keywordsOf, type PageBlockTree, type PageCopy, type Network, type TrackingSettings } from "./renderPages";
import { themeFromBrandColors, applySectionBands } from "./pageTheme";
import { db } from "./core";
import { uploadImageRef, CLD_FOLDER } from "@/lib/cloudinary/upload";
import type { FbAdAngle, SocialPost } from "@/lib/shared";
import { MAX_SMS_BODY, SMS_OPT_OUT } from "@/lib/sms";
import { META_HEADLINE_RECOMMENDED, META_PRIMARY_TEXT_RECOMMENDED } from "@/lib/adCompliance";
import { wants, type KitAssetKey, type CountableKitAssetKey } from "@/lib/kitAssets";
import { withVideoBlock, withQuizBlock, VIDEO_FIRST_TYPES, SURVEY_TYPES } from "@/lib/funnelTemplates";
import { stripDisclosureParagraphs, stripDisclosureFromCopy, isDisclosureText } from "@/lib/disclosure";

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

// Every channel resolves to the SAME URL now — the operator's pasted link, used verbatim. The
// per-channel map survives only because a dozen downstream shapes read `hoplink_by_channel.fb` and
// friends; collapsing it would be a wide rename for no behaviour change. See affiliateLink() for
// why the per-channel tid is gone.
function buildHoplinks(override?: string | null) {
  const tids = ["fb", "tt", "blog", "email", "page"] as const;
  const link = affiliateLink(override);
  const byChannel = Object.fromEntries(tids.map((t) => [t, link])) as Record<
    (typeof tids)[number],
    string
  >;
  // Empty when nothing is pasted yet, and the prompt says so rather than the model inventing one:
  // stagePages/stageContent are told to use this value and nothing else (content rule 4).
  const text = link ? tids.map((t) => `${t}: ${link}`).join("\n") : "";
  return { text, byChannel };
}

/**
 * One line of meta text, cut to a real limit on a word boundary.
 *
 * The model is ASKED for a length in the prompt, which is a request rather than a guarantee, and
 * the consumer of an over-long value is a search engine or a link preview that truncates silently
 * — so the visible failure is ours. Cutting mid-word looks like corrupt data, hence the boundary;
 * an empty result is returned as "" so callers can distinguish "not generated" from "generated
 * and blank" and fall back rather than storing nothing meaningfully different from nothing.
 */
function clampMeta(raw: unknown, max: number): string {
  const text = (typeof raw === "string" ? raw : "").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.5 ? cut.slice(0, lastSpace) : cut).trimEnd()}\u2026`;
}

async function stageContext(product: ProductRow): Promise<StageOutput> {
  const page = product.sales_page_url
    ? await fetchSalesPage(product.sales_page_url)
    : {
        ok: false,
        text: null,
        imageCandidates: [] as ImageCandidate[],
        brandColors: [] as string[],
        brandStyle: {} as BrandStyle,
      };
  const hoplinks = buildHoplinks(product.hoplink_override);
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
  // Up to three: a hero, and one apiece for two of the sections below it. More than that stops
  // being illustration and starts being page weight — see fetchImagesWithBudget, which caps the
  // total regardless of how many come back.
  const picked =
    candidates.length > 0 ? await pickProductImages(candidates, _product.product_title, 3, usage) : [];
  const dataUrls = await fetchImagesWithBudget(picked.map((p) => p.url));
  return {
    // image_data_url stays the FIRST image: embedded_image_data_url, the Instagram poster and the
    // ad-creative fallback all read it, and they each want one hero shot, not a gallery.
    stageData: { ...prior, image_data_url: dataUrls[0] ?? null, image_data_urls: dataUrls },
    campaignPatch: { images_json: { source_images: picked.map((p) => p.url) } },
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
      `Keep each headline at or under ${META_HEADLINE_RECOMMENDED} characters and each primary_text at or under ${META_PRIMARY_TEXT_RECOMMENDED}: Meta's own Ads Guide recommends those, and longer copy is silently truncated mid-sentence in the feed so the hook never lands. ` +
        `fb_ad_angles — exactly ${counts.fb_ads} distinct Meta-compliant ad angles for this product, each as a structured object with a headline, primary_text, description, and cta.`
    );
    // A Facebook primary text alone runs to 100-150 words, so this is per-angle headroom rather
    // than a measurement of the average.
    budget.push({ perItem: 280, count: counts.fb_ads });
  }
  if (wantTiktok) {
    // STRUCTURED, not a markdown blob. Each script has to be individually addressable so it can own
    // a generated video the way an ad angle does — campaign_creatives keys on item_index, and a
    // blob has no index. The legacy tiktok_md column is simply no longer written; old rows keep
    // theirs and the panel falls back to rendering it (the fb_ads_md / social_md precedent).
    properties.tiktok_scripts = {
      type: "array",
      minItems: counts.tiktok,
      maxItems: counts.tiktok,
      items: {
        type: "object",
        properties: { hook: { type: "string" }, script: { type: "string" } },
        required: ["hook", "script"],
      },
    };
    required.push("tiktok_scripts");
    asks.push(
      `tiktok_scripts — exactly ${counts.tiktok} TikTok concepts, each an object with a "hook" (one spoken opening line, under 15 words) and a "script" (the full 30-45s UGC-style script: spoken lines plus bracketed shot notes).`
    );
    budget.push({ perItem: 380, count: counts.tiktok });
  }

  const result = await completeJSON<{
    fb_ad_angles?: FbAdAngle[];
    tiktok_scripts?: { hook: string; script: string }[];
  }>({
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
  if (wantTiktok && (!Array.isArray(result.tiktok_scripts) || result.tiktok_scripts.length !== counts.tiktok)) {
    throw new Error(`Model did not return exactly ${counts.tiktok} TikTok scripts`);
  }
  return { stageData: prior, campaignPatch: result };
}

/**
 * Per-type authoring brief, spliced into the prompt. The SCHEMA stays the permanent flat shape —
 * these change what the model writes into it, and the structural differences (video slot, quiz,
 * no form) are applied as post-passes on the normalized tree using the same helpers hand-built
 * funnels use, so the two paths cannot drift into different ideas of what a VSL page is.
 */
const FUNNEL_TYPE_BRIEFS: Record<string, string> = {
  bridge: "", // the historical default — the base prompt already describes it
  advertorial:
    "\n\nThis page is an ADVERTORIAL: a story-style editorial presell with no opt-in form. Write the lead as a first-person or reported story that earns attention before mentioning the product; the mechanism explains the discovery inside the story; the CTA label invites clicking through to the offer (e.g. \"See the full story\"), never \"submit\" or \"sign up\" language.",
  squeeze:
    "\n\nThis page is a SQUEEZE page: short and single-minded. The lead is 2-3 sentences on the single result the free resource delivers; benefits are punchy one-liners; the CTA label asks for the download/access. Total copy should be far shorter than a sales page — brevity is the format.",
  summit:
    "\n\nThis page REGISTERS people for an event/summit-style presentation. The lead sells the moment (\"what you'll learn on the day\"), benefits are session takeaways, and the CTA label is registration language (\"Save my seat\").",
  application:
    "\n\nThis page starts an APPLICATION. Position the offer as selective: the lead states who this is for and who it is not, the mechanism describes the process after applying, and the CTA label is application language (\"Apply now\").",
  vsl:
    "\n\nThis page hosts a VIDEO SALES LETTER. The copy SUPPORTS a video embedded above it, so the headline teases what the video reveals, the lead is 2-3 sentences that make someone press play, and the remaining sections back up the video's claims for people who scroll. Do not describe or narrate the video's content shot-by-shot.",
  webinar:
    "\n\nThis page registers people for a WEBINAR. Headline names the training's promise, the lead says what will be taught and how long it runs, benefits are what attendees walk away able to do, and the CTA label is registration language.",
  survey:
    "\n\nThis page opens with a short SURVEY/quiz that sorts visitors before the pitch. Write the lead to frame answering the question as the fast way to a personalised answer; keep the sections short — the question is the star of the page.",
};

async function stagePages(
  product: ProductRow,
  prior: Record<string, unknown>,
  usage: UsageContext,
  campaignId: string,
  funnelType: string = "bridge"
): Promise<StageOutput> {
  const ctx = productContext(product, (prior.sales_text as string | null) ?? null);
  const typeBrief = FUNNEL_TYPE_BRIEFS[funnelType] ?? "";
  const copy = await completeJSON<PageCopy>({
    system: COMPLIANCE_SYSTEM,
    prompt: `${ctx}${typeBrief}\n\nWrite bridge (landing) page copy: a headline, a lead paragraph, a "mechanism" explanation (why/how it works), 3-5 benefit bullets, a short proof/credibility paragraph, 3-4 FAQ pairs, and a short CTA button label.

Do NOT include an affiliate-disclosure sentence anywhere in this copy — the page template appends its own code-owned disclosure automatically, and a second one written into the lead paragraph renders as one dense block that says the same thing twice.

Also plan the search targeting for this offer: one primary keyword a real buyer would type, 3-6 secondary/semantic keywords, and the search intent (informational, commercial or transactional). Base them on the sales page's own language — do not invent volume figures or difficulty scores, which you cannot know.

Finally, write the page's own meta tags: seo_title (max 60 characters, so it isn't truncated in a result or a link preview) and seo_description (max 155 characters, one sentence that would make someone click). The description must not simply repeat the headline — a description that restates the title is treated as no description at all.`,
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
        seo_title: { type: "string" },
        seo_description: { type: "string" },
      },
      required: ["headline", "lead", "mechanism", "benefits", "proof", "faq", "cta"],
    },
    // seo_* stay OUT of `required` deliberately. They are the least important field in the object
    // and the model returning the whole payload one field short is a stage failure that costs the
    // entire page; a missing description falls back to the lead paragraph (descriptionOf) and
    // nobody notices. Never make a nice-to-have field mandatory in a call this expensive to lose.
    maxTokens: 3000,
    usage,
  });

  const byChannel = (prior.hoplink_by_channel as Record<string, string>) ?? {};
  // The hero picked in the image stage, hosted rather than inlined. It is written into
  // embedded_image_data_url AND baked into bridge_html, so uploading it here — before the render
  // below — is what stops a freshly built campaign from being born with base64 in three places.
  //
  // The workspace comes from the campaign row rather than being threaded through
  // runBuildCampaignStage's already long signature: it is the authoritative owner of this asset,
  // and letting stamp_workspace_id infer it from user_id would file it under the user's FIRST
  // workspace, which CLAUDE.md records going wrong for real elsewhere.
  const rawImageDataUrl = (prior.image_data_url as string | null) ?? null;
  const { data: campaignOwner } = await db
    .from("campaigns")
    .select("workspace_id, user_id")
    .eq("id", campaignId)
    .maybeSingle();
  const imageDataUrl =
    campaignOwner
      ? await uploadImageRef(db, rawImageDataUrl, CLD_FOLDER.campaign, {
          workspaceId: campaignOwner.workspace_id as string,
          userId: campaignOwner.user_id as string,
        })
      : rawImageDataUrl;
  // `|| "#"`, not `??`: byChannel.page is now the empty string when nothing has been pasted, which
  // `??` would happily pass through as an href. products.hoplink is deliberately not a fallback —
  // it holds links this app used to derive and must never be resurrected.
  const hoplink = byChannel.page || "#";
  // The Anthropic structured-output schema above stays the permanent flat authoring shape (see
  // lib/engine/renderPages.ts's header comment) — normalize it into a block tree once here so
  // every newly-built campaign persists version-2 page_copy going forward, rather than relying on
  // renderBridgeHtml's own internal (idempotent) normalization at every future read.
  // The prompt tells the model not to write a disclosure; this is what happens when it does
  // anyway, which it has on live pages in three different shapes. Applied BEFORE normalizePageCopy
  // so the duplicate never reaches the tree — and so it can never become the meta description,
  // which is what a disclosure in a lead paragraph turns into. Empty proof/mechanism sections are
  // dropped by the renderer, so a field that was ONLY a disclosure leaves no hole.
  const cleaned = {
    ...copy,
    lead: stripDisclosureFromCopy(copy.lead),
    mechanism: stripDisclosureFromCopy(copy.mechanism),
    proof: stripDisclosureFromCopy(copy.proof),
  };
  let tree = normalizePageCopy(cleaned, imageDataUrl, {
    siteName: product.product_title,
    extraImages: (prior.image_data_urls as string[] | undefined)?.slice(1) ?? [],
    // The advertorial's defining structural difference: no lead-capture form, the locked
    // primary_cta carries the click to the offer.
    leadForm: funnelType === "advertorial" ? false : undefined,
  });
  // Structural passes shared with hand-built funnels (lib/funnelTemplates.ts), so an AI VSL and a
  // hand-made VSL are the same shape: an empty video slot above the copy (the operator pastes the
  // video — inventing a source would be worse than a visible empty slot), and the survey types get
  // the bucket question, unrouted, for exactly the reasons withQuizBlock documents.
  const headlineText =
    typeof (copy as { headline?: unknown }).headline === "string" ? (copy as any).headline : product.product_title;
  if (VIDEO_FIRST_TYPES.has(funnelType)) tree = withVideoBlock(tree, headlineText);
  if (SURVEY_TYPES.has(funnelType)) tree = withQuizBlock(tree);
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
  if (brandTheme) {
    tree.theme = brandTheme;
    // Tinted bands behind the grid sections, from the same accent — see applySectionBands for why
    // this is a post-pass and why only sections containing a row get one.
    tree = applySectionBands(tree, brandTheme.colors?.primary);
  }
  // A REBUILD of a campaign whose funnel already has tracking settings must keep its snippets —
  // fresh builds just read null here (the column defaults to null until funnel settings set it).
  const { data: trackingRow } = await db.from("campaigns").select("tracking").eq("id", campaignId).maybeSingle();
  const tracking = (trackingRow?.tracking ?? null) as TrackingSettings | null;
  // Clamped here rather than trusted: these are the two values that end up in a <title> and a
  // meta tag, the model is asked for a length rather than held to one, and an over-long title is
  // silently truncated by the consumer — which reads as our bug, not as a long title.
  // A disclosure is never a description. The model has been observed writing one into copy it was
  // told not to, and a meta description reading "This page contains affiliate links" is the least
  // useful sentence available in the one place that decides whether anyone clicks.
  const seoDesc = clampMeta((copy as any).seo_description, 155);
  const seo = {
    seo_title: clampMeta((copy as any).seo_title, 60),
    seo_description: isDisclosureText(seoDesc) ? "" : seoDesc,
  };
  const bridgeHtml = renderBridgeHtml(product, tree, hoplink, imageDataUrl, campaignId, null, tracking, seo);

  return {
    // Carried forward so the blog stage can write TO the plan rather than inventing its own
    // targeting — planning first and then writing is the whole point of doing it in this order.
    stageData: { ...prior, keywords: planned },
    campaignPatch: {
      bridge_html: bridgeHtml,
      page_copy: tree,
      embedded_image_data_url: imageDataUrl,
      // Stored so the publish checklist (funnelPageChecklist takes funnel_type), the funnel map
      // and the type badge all know what this page IS. AI builds used to leave it null, which
      // read as "bridge" everywhere by fallback.
      funnel_type: funnelType,
      // Only written when the model actually produced one — a rebuild must not blank a description
      // the operator wrote by hand in the funnel's SEO panel.
      ...(seo.seo_title ? { seo_title: seo.seo_title } : {}),
      ...(seo.seo_description ? { seo_description: seo.seo_description } : {}),
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

  const result = await completeJSON<{
    blog_md: string;
    excerpt?: string;
    seo_title?: string;
    seo_description?: string;
  }>({
    system: COMPLIANCE_SYSTEM,
    prompt: `${ctx}${keywordBrief}\n\nWrite a 1200-1800 word SEO-style blog article about this niche/product for the "tid=blog" traffic channel, in Markdown, with a clear intro/body/conclusion and natural keyword usage.

Do NOT write an affiliate-disclosure sentence anywhere in the article. The post template appends its own code-owned disclosure at the very bottom of every page, so one written into the copy renders the same notice twice — and if it lands near the top it becomes the article's meta description and search-result snippet, which is the least useful sentence you could put there.

Link to the offer 2-3 times where it reads naturally — once early, once in the body, once in the conclusion — as Markdown links whose target is exactly the placeholder ${OFFER_LINK_TOKEN}, e.g. "[see the full programme](${OFFER_LINK_TOKEN})". Never write a real URL, a domain, or any other link target: the placeholder is substituted for the reader's tracked affiliate link afterwards, and anything else you invent would not track and may not resolve.

Also write the article's own metadata, as separate fields — never inside blog_md:
- excerpt: 1-2 sentences (max 200 characters) summarising what the reader gets. This is the card blurb on the blog index, so it has to make sense with no article around it.
- seo_title: max 60 characters, so search results and link previews don't truncate it. Include the primary keyword.
- seo_description: max 155 characters, one sentence written to earn a click. Do not restate seo_title — a description that repeats the title is treated as no description at all.`,
    schema: {
      type: "object",
      properties: {
        blog_md: { type: "string" },
        excerpt: { type: "string" },
        seo_title: { type: "string" },
        seo_description: { type: "string" },
      },
      // Only the article is required. The three metadata fields are the cheapest thing in this
      // object and the article is the most expensive — making them mandatory would let a missing
      // one-line description throw away 1800 words. Every consumer already derives a fallback.
      required: ["blog_md"],
    },
    maxTokens: 6000,
    usage,
  });

  return {
    stageData: prior,
    campaignPatch: {
      blog_md: withOfferLinks(stripDisclosureParagraphs(result.blog_md), blogHoplink),
      // Written only when produced, for the same reason the funnel's are: a rebuild must not blank
      // metadata someone edited by hand. createPostFromCampaign copies these onto the post.
      ...(clampMeta(result.excerpt, 200) ? { blog_excerpt: clampMeta(result.excerpt, 200) } : {}),
      ...(clampMeta(result.seo_title, 60) ? { blog_seo_title: clampMeta(result.seo_title, 60) } : {}),
      ...(clampMeta(result.seo_description, 155)
        ? { blog_seo_description: clampMeta(result.seo_description, 155) }
        : {}),
    },
  };
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

  if (wants(assets, "sms")) {
    properties.sms_messages = {
      type: "array",
      minItems: counts.sms,
      maxItems: counts.sms,
      items: {
        type: "object",
        properties: { body: { type: "string", maxLength: MAX_SMS_BODY } },
        required: ["body"],
      },
    };
    required.push("sms_messages");
    asks.push(
      `sms_messages — exactly ${counts.sms} SMS messages for leads who opted in to texts, each an object with a body field. ` +
        `HARD LIMIT: each body must be ${MAX_SMS_BODY} characters or fewer, because we append "${SMS_OPT_OUT}" to the first one and the total has to stay inside a single 160-character segment — one character over and the message bills as two. ` +
        `Do NOT write "${SMS_OPT_OUT}", "Text STOP", "unsubscribe", or any opt-out wording yourself: it is added automatically, and a second copy wastes characters that are being paid for. ` +
        `No ALL-CAPS words, no more than one exclamation mark across the whole sequence, and no "FREE" or "$$$"-style shouting — carriers filter those before a human ever sees them. ` +
        `Write like a person texting, not a broadcast: short sentences, one idea per message, and only the claims the sales page itself makes.`
    );
    // Short by construction, but the ask above is long, so give the call real headroom.
    budget.push({ perItem: 90, count: counts.sms });
  }

  const result = await completeJSON<{ social_posts?: SocialPost[]; email_md?: string; sms_messages?: { body: string }[] }>({
    system: COMPLIANCE_SYSTEM,
    prompt: `${ctx}\n\nWrite:\n${asks.map((a, i) => `${i + 1}. ${a}`).join("\n")}`,
    schema: { type: "object", properties, required },
    maxTokens: maxTokensFor(budget),
    usage,
  });
  if (wantSocial && (!Array.isArray(result.social_posts) || result.social_posts.length !== counts.social)) {
    throw new Error(`Model did not return exactly ${counts.social} social posts`);
  }
  if (wants(assets, "sms")) {
    if (!Array.isArray(result.sms_messages) || result.sms_messages.length !== counts.sms) {
      throw new Error(`Model did not return exactly ${counts.sms} SMS messages`);
    }
    // maxLength in the schema is a request, not a guarantee — the same lesson repairDoubleEncoded
    // records about forced tool-use. Truncating here rather than failing the stage: an over-long
    // text is still usable copy the operator can tighten, whereas failing loses the whole kit.
    result.sms_messages = result.sms_messages.map((m) => ({
      body: String(m?.body ?? "").trim().slice(0, MAX_SMS_BODY),
    }));
  }
  return { stageData: prior, campaignPatch: result };
}

export async function runBuildCampaignStage(
  stageIndex: number,
  product: ProductRow,
  priorStageData: Record<string, unknown>,
  usageCtx: { userId: string; jobId: string },
  campaignId: string,
  assets: KitAssetKey[],
  counts: Record<CountableKitAssetKey, number>,
  funnelType: string = "bridge"
): Promise<StageOutput> {
  const stage = BUILD_CAMPAIGN_STAGES[stageIndex];
  const usage: UsageContext = { ...usageCtx, jobType: "build_campaign", stage };
  switch (stage) {
    case "context":
      // Always runs. It fetches the sales page and builds the hoplinks — every other stage reads
      // its output, and the hoplinks are the product's tracking links regardless of what else was
      // asked for. It also makes no Anthropic call, so there is nothing to save by skipping it.
      return stageContext(product);
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
        ? stagePages(product, priorStageData, usage, campaignId, funnelType)
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
