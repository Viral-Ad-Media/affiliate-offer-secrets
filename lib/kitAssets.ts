// Which pieces of a campaign kit to actually generate.
//
// Every build used to produce all nine assets whether or not the operator wanted them — which is
// wasted Anthropic spend and a longer wait for someone who never runs TikTok, or who only wants a
// funnel page. This is the list they choose from.
//
// The keys are deliberately the ASSET axis, not the stage axis. lib/engine/build.ts's six stages
// don't line up with how a person thinks about this: `ads` is a single Anthropic call producing
// Facebook angles AND TikTok scripts together, and `social` likewise produces organic captions AND
// the email sequence. Letting someone drop TikTok while keeping Facebook therefore means building
// those two stages' schema and prompt from the selection, not just skipping whole stages.
export const KIT_ASSETS = [
  { key: "funnel", label: "Funnel page", hint: "Bridge/opt-in page — the destination your ads point at" },
  { key: "fb_ads", label: "Facebook / Instagram ads", hint: "Ad angles with headline, copy and CTA" },
  { key: "tiktok", label: "TikTok scripts", hint: "Hooks and 30-45s UGC-style video scripts" },
  { key: "social", label: "Social captions", hint: "Short organic posts" },
  { key: "email", label: "Email sequence", hint: "Swipe emails, subject + body" },
  { key: "sms", label: "SMS sequence", hint: "Short texts for the leads who opted in to messages" },
  { key: "blog", label: "Blog article", hint: "Long-form article, also imported as a draft blog post" },
] as const;

export type KitAssetKey = (typeof KIT_ASSETS)[number]["key"];

/**
 * How many of each asset to generate, for the ones where "how many" is a real question.
 *
 * The counts used to be baked into three places at once per asset — the JSON Schema's
 * minItems/maxItems, the wording of the prompt, and a defensive length check on the way back — so
 * they were a constant in the truest sense. They are now a number the operator picks.
 *
 * `funnel` and `blog` are deliberately absent. A funnel is one page, and the blog stage writes a
 * single `blog_md` string that `createPostFromCampaign` turns into one post — asking for three
 * articles would need a different stage shape, not a bigger number.
 *
 * The MAXIMUM is not a preference. Everything in a stage comes back from ONE Anthropic call, and
 * exceeding the output budget truncates the JSON mid-object, which fails the stage, burns the
 * retries and ends as a terminal error with nothing generated. 10 is what the budget below
 * comfortably covers; raising it means raising `maxTokensFor` with it and checking the arithmetic.
 */
export const KIT_ASSET_COUNTS = {
  fb_ads: { default: 3, min: 1, max: 10, noun: "angles" },
  tiktok: { default: 3, min: 1, max: 10, noun: "scripts" },
  social: { default: 5, min: 1, max: 10, noun: "captions" },
  email: { default: 3, min: 1, max: 10, noun: "emails" },
  sms: { default: 3, min: 1, max: 10, noun: "messages" },
} as const;

export type CountableKitAssetKey = keyof typeof KIT_ASSET_COUNTS;
export type KitAssetCounts = Partial<Record<CountableKitAssetKey, number>>;

export const COUNTABLE_KIT_ASSETS = Object.keys(KIT_ASSET_COUNTS) as CountableKitAssetKey[];

export function isCountable(key: KitAssetKey): key is CountableKitAssetKey {
  return (COUNTABLE_KIT_ASSETS as string[]).includes(key);
}

/**
 * Normalise caller-supplied counts, the same way `normalizeKitAssets` normalises the selection:
 * anything absent, non-numeric or out of range falls back to the default it had before counts
 * existed. A job queued before this shipped carries no `counts` at all and must behave exactly as
 * it did — 3 angles, 3 scripts, 5 captions, 3 emails.
 */
export function normalizeKitCounts(raw: unknown): Record<CountableKitAssetKey, number> {
  const supplied = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out = {} as Record<CountableKitAssetKey, number>;
  for (const key of COUNTABLE_KIT_ASSETS) {
    const spec = KIT_ASSET_COUNTS[key];
    const v = supplied[key];
    // An emptied input is "I didn't say", not "give me the minimum" — and `Number("")` is 0, which
    // is finite, so without this it would clamp to the minimum instead of falling back. Someone who
    // clears the box to retype and then hits Build would silently get 1 email.
    const blank = v === null || v === undefined || (typeof v === "string" && v.trim() === "");
    const n = blank ? NaN : Number(v);
    out[key] = Number.isFinite(n) ? Math.min(spec.max, Math.max(spec.min, Math.round(n))) : spec.default;
  }
  return out;
}

export const ALL_KIT_ASSETS: KitAssetKey[] = KIT_ASSETS.map((a) => a.key);

/**
 * Normalise a caller-supplied selection.
 *
 * Absent or empty means EVERYTHING, deliberately: that's what a build did before this existed, so
 * an older client, a direct API call, or a job queued before this shipped all keep their previous
 * behaviour instead of silently producing an empty kit.
 */
export function normalizeKitAssets(raw: unknown): KitAssetKey[] {
  if (!Array.isArray(raw)) return [...ALL_KIT_ASSETS];
  const picked = raw.filter((v): v is KitAssetKey => ALL_KIT_ASSETS.includes(v as KitAssetKey));
  return picked.length > 0 ? Array.from(new Set(picked)) : [...ALL_KIT_ASSETS];
}

export function wants(assets: KitAssetKey[], key: KitAssetKey): boolean {
  return assets.includes(key);
}

/**
 * The funnel page is what an ad has to point at, so choosing ads without it is very likely a
 * mistake. Surfaced as a warning in the UI rather than enforced — someone may legitimately want
 * only ad copy to paste elsewhere, and refusing would be this tool deciding it knows better.
 */
export function adsWithoutFunnel(assets: KitAssetKey[]): boolean {
  return !wants(assets, "funnel") && (wants(assets, "fb_ads") || wants(assets, "tiktok"));
}
