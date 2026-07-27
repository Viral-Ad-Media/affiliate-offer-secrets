// One Google Cloud OAuth client shared between YouTube-connect and Mail-connect, each with its
// own callback route, own state-cookie name, and own disjoint scope list — never combined, so
// the YouTube flow can never accidentally request (and receive consent for) gmail.send, or vice
// versa. A code issued for one flow can't be exchanged at the other's callback regardless: Google
// requires the exchange's redirect_uri to exactly match the one used to obtain the code.
export const GOOGLE_OAUTH_BASE = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

export const YOUTUBE_SCOPES = ["https://www.googleapis.com/auth/youtube.readonly"];
// Deliberately not a read scope.
export const MAIL_SCOPES = ["https://www.googleapis.com/auth/gmail.send"];

export function getGoogleClientId(): string {
  const id = process.env.GOOGLE_CLIENT_ID;
  if (!id) throw new Error("GOOGLE_CLIENT_ID is not set");
  return id;
}

export function getGoogleClientSecret(): string {
  const secret = process.env.GOOGLE_CLIENT_SECRET;
  if (!secret) throw new Error("GOOGLE_CLIENT_SECRET is not set");
  return secret;
}

function appUrl(): string {
  const url = process.env.NEXT_PUBLIC_APP_URL;
  if (!url) throw new Error("NEXT_PUBLIC_APP_URL is not set");
  return url;
}

export function getYoutubeRedirectUri(): string {
  return `${appUrl()}/api/youtube/callback`;
}

export function getMailRedirectUri(): string {
  return `${appUrl()}/api/mail/callback`;
}
