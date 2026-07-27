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
