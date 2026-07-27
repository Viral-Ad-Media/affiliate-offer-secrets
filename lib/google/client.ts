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

// Gmail's own profile endpoint — works with just the gmail.send scope already granted, no
// separate userinfo.email/openid scope needed.
export async function getGmailProfile(accessToken: string): Promise<{ emailAddress: string }> {
  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(15_000),
  });
  const json = await res.json();
  if (json.error) throw new GoogleApiError(json.error.message ?? "Gmail profile request failed");
  return json;
}

function base64UrlEncode(input: string): string {
  return Buffer.from(input, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function sendGmailMessage(
  accessToken: string,
  opts: { to: string; subject: string; html: string }
): Promise<{ id: string }> {
  const mime = [
    `To: ${opts.to}`,
    `Subject: ${opts.subject}`,
    "Content-Type: text/html; charset=utf-8",
    "MIME-Version: 1.0",
    "",
    opts.html,
  ].join("\r\n");

  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw: base64UrlEncode(mime) }),
    signal: AbortSignal.timeout(15_000),
  });
  const json = await res.json();
  if (json.error) throw new GoogleApiError(json.error.message ?? "Gmail send failed");
  return json;
}
