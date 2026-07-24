export const FB_API_VERSION = "v21.0";
export const FB_GRAPH_BASE = `https://graph.facebook.com/${FB_API_VERSION}`;

// Minimal scope for Phase B (posting only) — ads_management (already approved) is intentionally
// not requested here; Phase C requests it separately when ad-launch is built.
export const FB_OAUTH_SCOPES = ["pages_show_list", "pages_manage_posts", "pages_read_engagement"];

export function getFbClientId(): string {
  const id = process.env.FB_CLIENT_ID;
  if (!id) throw new Error("FB_CLIENT_ID is not set");
  return id;
}

export function getFbClientSecret(): string {
  const secret = process.env.FB_CLIENT_SECRET;
  if (!secret) throw new Error("FB_CLIENT_SECRET is not set");
  return secret;
}

// Must exactly match a redirect URI registered in the Meta App dashboard — cannot be derived
// per-request the way Stripe's success_url is.
export function getFbRedirectUri(): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) throw new Error("NEXT_PUBLIC_APP_URL is not set");
  return `${appUrl}/api/meta/callback`;
}
