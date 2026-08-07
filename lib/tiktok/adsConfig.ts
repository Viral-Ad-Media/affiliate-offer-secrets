/**
 * TikTok Marketing API config — deliberately SEPARATE from lib/tiktok/config.ts.
 *
 * That file is Login Kit: `TIKTOK_CLIENT_KEY`/`TIKTOK_CLIENT_SECRET`, scopes `user.info.basic` +
 * `video.publish`, used to post organic videos. The Marketing API is a different TikTok for
 * Business app with its own numeric `app_id`, its own secret, its own OAuth endpoint, and a token
 * scoped to ADVERTISERS rather than to a creator account. Sharing either constant between the two
 * would produce a token that silently works for one surface and 40105s on the other.
 *
 * Everything here was verified live against the real API on 2026-08-06 (see lib/tiktok/ads.ts).
 */

// Its OWN state cookie, distinct from Login Kit's `tiktok_oauth_state`: someone can plausibly be
// connecting their creator account and their ad account in two tabs, and a shared name would make
// whichever finished second fail CSRF validation. Lives here rather than in the connect route
// because a Next.js route module may only export its handlers and a fixed set of config keys —
// exporting a constant from one fails the production build (tsc alone does not catch this).
export const TIKTOK_ADS_STATE_COOKIE = "tiktok_ads_oauth_state";

export const TIKTOK_ADS_API_BASE = "https://business-api.tiktok.com/open_api/v1.3";

// Where a tenant is sent to authorise advertisers. This is the portal, not the open_api host.
const TIKTOK_ADS_AUTH_URL = "https://business-api.tiktok.com/portal/auth";

export function getTiktokAdsAppId(): string {
  const v = process.env.TIKTOK_ADS_APP_ID;
  if (!v) throw new Error("TIKTOK_ADS_APP_ID is not set");
  return v;
}

export function getTiktokAdsSecret(): string {
  const v = process.env.TIKTOK_ADS_SECRET;
  if (!v) throw new Error("TIKTOK_ADS_SECRET is not set");
  return v;
}

/** Registered on the TikTok for Business app; must match byte-for-byte at token exchange. */
export function getTiktokAdsRedirectUri(): string {
  return (
    process.env.TIKTOK_ADS_REDIRECT_URI ??
    `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/api/tiktok-ads/callback`
  );
}

/** True when the Marketing API app is configured at all — the UI gates on this rather than throwing. */
export function tiktokAdsConfigured(): boolean {
  return Boolean(process.env.TIKTOK_ADS_APP_ID && process.env.TIKTOK_ADS_SECRET);
}

export function buildTiktokAdsAuthUrl(state: string): string {
  const params = new URLSearchParams({
    app_id: getTiktokAdsAppId(),
    state,
    redirect_uri: getTiktokAdsRedirectUri(),
  });
  return `${TIKTOK_ADS_AUTH_URL}?${params.toString()}`;
}
