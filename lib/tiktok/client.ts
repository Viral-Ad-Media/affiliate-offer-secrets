import { TIKTOK_API_BASE, getTiktokClientKey, getTiktokClientSecret, getTiktokRedirectUri } from "./config";

export class TiktokApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TiktokApiError";
  }
}

export type TiktokTokenResponse = {
  access_token: string;
  expires_in: number;
  refresh_token: string;
  refresh_expires_in: number;
  open_id: string;
  scope: string;
  token_type: string;
};

export async function exchangeTiktokCode(code: string): Promise<TiktokTokenResponse> {
  const res = await fetch(`${TIKTOK_API_BASE}/oauth/token/`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      client_key: getTiktokClientKey(),
      client_secret: getTiktokClientSecret(),
      code,
      grant_type: "authorization_code",
      redirect_uri: getTiktokRedirectUri(),
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const json = await res.json();
  if (json.error) throw new TiktokApiError(json.error_description ?? json.error);
  return json;
}

export type TiktokRefreshResponse = { access_token: string; expires_in: number; refresh_token: string };

export async function refreshTiktokToken(refreshToken: string): Promise<TiktokRefreshResponse> {
  const res = await fetch(`${TIKTOK_API_BASE}/oauth/token/`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      client_key: getTiktokClientKey(),
      client_secret: getTiktokClientSecret(),
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const json = await res.json();
  if (json.error) throw new TiktokApiError(json.error_description ?? json.error);
  return json;
}

export type TiktokUserInfo = { open_id: string; display_name: string; avatar_url: string };

export async function getTiktokUserInfo(accessToken: string): Promise<TiktokUserInfo> {
  const res = await fetch(
    `${TIKTOK_API_BASE}/user/info/?fields=open_id,display_name,avatar_url`,
    { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(15_000) }
  );
  const json = await res.json();
  if (json.error?.code && json.error.code !== "ok") {
    throw new TiktokApiError(json.error.message ?? "TikTok user info request failed");
  }
  return json.data.user;
}

// Content Posting API, PULL_FROM_URL mode — TikTok fetches the video from our given (signed)
// URL rather than us doing a chunked upload, since a durable storage object already exists.
// privacy_level is hardcoded to SELF_ONLY: unaudited apps aren't approved for public "Direct
// Post" and must use a restricted visibility level — sufficient for testing on your own account,
// same caveat shape as every other platform's review requirement in this project. Query
// /v2/post/publish/creator_info/query/ for the account's actually-available privacy levels if
// this needs to move beyond self-testing later.
export async function initTiktokVideoPost(
  accessToken: string,
  videoUrl: string,
  title: string
): Promise<string> {
  const res = await fetch(`${TIKTOK_API_BASE}/post/publish/video/init/`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      post_info: {
        title,
        privacy_level: "SELF_ONLY",
        disable_duet: false,
        disable_comment: false,
        disable_stitch: false,
      },
      source_info: { source: "PULL_FROM_URL", video_url: videoUrl },
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const json = await res.json();
  if (json.error?.code && json.error.code !== "ok") {
    throw new TiktokApiError(json.error.message ?? "TikTok video post init failed");
  }
  const publishId = json.data?.publish_id;
  if (!publishId) throw new TiktokApiError("TikTok video post init returned no publish_id");
  return publishId as string;
}

// "PROCESSING_DOWNLOAD" | "PROCESSING_UPLOAD" | "PUBLISH_COMPLETE" | "FAILED" | ...
export async function getTiktokPostStatus(accessToken: string, publishId: string): Promise<string> {
  const res = await fetch(`${TIKTOK_API_BASE}/post/publish/status/fetch/`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ publish_id: publishId }),
    signal: AbortSignal.timeout(15_000),
  });
  const json = await res.json();
  if (json.error?.code && json.error.code !== "ok") {
    throw new TiktokApiError(json.error.message ?? "TikTok post status check failed");
  }
  return json.data?.status as string;
}
