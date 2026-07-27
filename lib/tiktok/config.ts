export const TIKTOK_OAUTH_BASE = "https://www.tiktok.com/v2/auth/authorize/";
export const TIKTOK_API_BASE = "https://open.tiktokapis.com/v2";

// Connect-only for now — no video.upload/video.publish requested (this app doesn't generate
// video yet). TikTok Developer apps typically need testers added manually before scopes work
// outside review, similar to Meta's Development Mode — sufficient for testing, not a surprise.
export const TIKTOK_SCOPES = ["user.info.basic"];

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
