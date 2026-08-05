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
  { key: "fb_ads", label: "Facebook / Instagram ads", hint: "3 ad angles with headline, copy and CTA" },
  { key: "tiktok", label: "TikTok scripts", hint: "Hooks and 30-45s UGC-style video scripts" },
  { key: "social", label: "Social captions", hint: "5 organic posts" },
  { key: "email", label: "Email sequence", hint: "3-email swipe" },
  { key: "blog", label: "Blog article", hint: "Long-form article, also imported as a draft blog post" },
] as const;

export type KitAssetKey = (typeof KIT_ASSETS)[number]["key"];

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
