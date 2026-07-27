export const TIKTOK_OAUTH_BASE = "https://www.tiktok.com/v2/auth/authorize/";
export const TIKTOK_API_BASE = "https://open.tiktokapis.com/v2";

// video.publish added now that video generation exists — existing connections need one re-auth
// to pick it up (same pattern as Meta's ads_management/instagram_content_publish additions).
// TikTok apps need approval for unaudited "Direct Post" beyond self-only/sandbox testing with
// added test users — sufficient to test yourself, same caveat shape as every other platform's
// review requirement in this project.
export const TIKTOK_SCOPES = ["user.info.basic", "video.publish"];

export function getTiktokClientKey(): string {
  const key = process.env.TIKTOK_CLIENT_KEY;
  if (!key) throw new Error("TIKTOK_CLIENT_KEY is not set");
  return key;
}

export function getTiktokClientSecret(): string {
  const secret = process.env.TIKTOK_CLIENT_SECRET;
  if (!secret) throw new Error("TIKTOK_CLIENT_SECRET is not set");
  return secret;
}

export function getTiktokRedirectUri(): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) throw new Error("NEXT_PUBLIC_APP_URL is not set");
  return `${appUrl}/api/tiktok/callback`;
}
