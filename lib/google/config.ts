// Google OAuth client for the YouTube connector. Gmail sending was retired in 0037 (gmail.send is
// a Google RESTRICTED scope requiring a security assessment to ship publicly) — outgoing mail now
// goes through the Resend/SendGrid/Mailgun/SMTP providers instead, so this client requests only
// YouTube scopes.
export const GOOGLE_OAUTH_BASE = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

// youtube.upload added now that video generation exists — broader/more sensitive than
// youtube.readonly, existing connections need one re-auth. Flag clearly: this is a more
// sensitive scope than youtube.readonly and would need Google's stricter OAuth verification
// before a public rollout beyond your own testing.
export const YOUTUBE_SCOPES = [
  "https://www.googleapis.com/auth/youtube.readonly",
  "https://www.googleapis.com/auth/youtube.upload",
];

// Checked BEFORE the connect route builds an auth URL: without this it threw an unhandled 500
// with a raw stack trace at anyone who clicked Connect, which is both a bad failure mode and hard
// to diagnose from outside. The empty-string case is deliberately treated as unconfigured — a
// declared-but-blank var in .env.local is the exact shape this hit in practice.
export function isGoogleOAuthConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

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

