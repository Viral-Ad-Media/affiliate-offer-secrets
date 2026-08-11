export const FB_API_VERSION = "v21.0";
export const FB_GRAPH_BASE = `https://graph.facebook.com/${FB_API_VERSION}`;

// ads_management is already App-Review-approved (per the user). Requesting it here means every
// new/re-run connect flow grants it; existing Phase-B-only connections need one re-auth to add
// it (Meta supports incremental auth — re-running the dialog keeps already-granted permissions).
// instagram_basic/instagram_content_publish added for Phase E's Instagram posting — existing
// connections need one re-auth to pick up the new scopes, same pattern as ads_management before.
export const FB_OAUTH_SCOPES = [
  "pages_show_list",
  "pages_manage_posts",
  "pages_read_engagement",
  "ads_management",
  "instagram_basic",
  "instagram_content_publish",
];

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

// Facebook Login FOR BUSINESS names its permission set in a dashboard-created "configuration"
// rather than in the request: per Meta's docs, "config_id has replaced scope ... although scope
// can still be included, we recommend that you do not use it". An app on that product receiving a
// classic scope-only dialog request answers "URL Blocked … redirect URI is not whitelisted",
// which reads as a redirect-URI problem and is not one — the URIs were registered correctly the
// whole time. Facebook's own login URL gives the product away with `is_business_login=1`.
//
// Env-driven rather than hardcoded because the two products need genuinely different requests and
// this app has already been pointed at a different Meta app once. Unset = the classic scope flow,
// byte-identical to before this existed.
export function getFbLoginConfigId(): string | null {
  const id = process.env.FB_LOGIN_CONFIG_ID?.trim();
  return id ? id : null;
}

// Must exactly match a redirect URI registered in the Meta App dashboard — cannot be derived
// per-request the way Stripe's success_url is. Meta matches the full URI exactly, every parameter
// included, with `state` the only exception.
export function getFbRedirectUri(): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) throw new Error("NEXT_PUBLIC_APP_URL is not set");
  return `${appUrl}/api/meta/callback`;
}
