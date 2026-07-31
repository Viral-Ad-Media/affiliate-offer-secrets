import { GOOGLE_TOKEN_URL, getGoogleClientId, getGoogleClientSecret } from "./config";

export class GoogleApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoogleApiError";
  }
}

export type GoogleTokenResponse = {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
  token_type: string;
};

export async function exchangeGoogleCode(code: string, redirectUri: string): Promise<GoogleTokenResponse> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: getGoogleClientId(),
      client_secret: getGoogleClientSecret(),
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const json = await res.json();
  if (json.error) throw new GoogleApiError(json.error_description ?? json.error);
  return json;
}

export async function refreshGoogleAccessToken(
  refreshToken: string
): Promise<{ access_token: string; expires_in: number }> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: getGoogleClientId(),
      client_secret: getGoogleClientSecret(),
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const json = await res.json();
  if (json.error) throw new GoogleApiError(json.error_description ?? json.error);
  return json;
}

export type YoutubeChannel = { id: string; title: string; thumbnailUrl: string | null };

export async function getMyYoutubeChannel(accessToken: string): Promise<YoutubeChannel | null> {
  const res = await fetch(
    "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true",
    { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(15_000) }
  );
  const json = await res.json();
  if (json.error) throw new GoogleApiError(json.error.message ?? "YouTube channels request failed");
  const channel = json.items?.[0];
  if (!channel) return null;
  return {
    id: channel.id,
    title: channel.snippet?.title ?? "",
    thumbnailUrl: channel.snippet?.thumbnails?.default?.url ?? null,
  };
}

// Single-shot upload (init + one PUT), not true chunked resumable upload — correct and much
// simpler for this app's short AI-generated clips (a few MB), which comfortably fit in one PUT.
// Defaults to privacyStatus "private": a safe default for testing on your own channel, same
// caveat shape as TikTok's SELF_ONLY default — change from YouTube Studio once you're ready for
// a real rollout.
export async function uploadYoutubeVideo(
  accessToken: string,
  bytes: Buffer,
  meta: { title: string; description: string; privacyStatus?: "private" | "unlisted" | "public" }
): Promise<{ id: string }> {
  const initRes = await fetch(
    "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "X-Upload-Content-Type": "video/mp4",
        "X-Upload-Content-Length": String(bytes.byteLength),
      },
      body: JSON.stringify({
        snippet: { title: meta.title, description: meta.description },
        status: { privacyStatus: meta.privacyStatus ?? "private" },
      }),
      signal: AbortSignal.timeout(20_000),
    }
  );
  if (!initRes.ok) {
    const errJson = await initRes.json().catch(() => ({}));
    throw new GoogleApiError(errJson.error?.message ?? `YouTube upload init failed (${initRes.status})`);
  }
  const uploadUrl = initRes.headers.get("location");
  if (!uploadUrl) throw new GoogleApiError("YouTube upload init returned no upload URL");

  const uploadRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": "video/mp4", "Content-Length": String(bytes.byteLength) },
    body: new Uint8Array(bytes),
    signal: AbortSignal.timeout(60_000),
  });
  const json = await uploadRes.json();
  if (!uploadRes.ok || json.error) {
    throw new GoogleApiError(json.error?.message ?? `YouTube upload failed (${uploadRes.status})`);
  }
  return { id: json.id as string };
}

