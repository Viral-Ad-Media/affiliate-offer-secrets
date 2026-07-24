import { FB_GRAPH_BASE, getFbClientId, getFbClientSecret, getFbRedirectUri } from "./config";

export class MetaApiError extends Error {
  code?: number;
  subcode?: number;
  constructor(message: string, code?: number, subcode?: number) {
    super(message);
    this.code = code;
    this.subcode = subcode;
  }
}

async function graphGet(path: string, params: Record<string, string>) {
  const url = new URL(`${FB_GRAPH_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString(), { signal: AbortSignal.timeout(15_000) });
  const json = await res.json();
  if (json.error) throw new MetaApiError(json.error.message, json.error.code, json.error.error_subcode);
  return json;
}

async function graphPost(path: string, params: Record<string, string>) {
  const url = new URL(`${FB_GRAPH_BASE}${path}`);
  const res = await fetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
    signal: AbortSignal.timeout(15_000),
  });
  const json = await res.json();
  if (json.error) throw new MetaApiError(json.error.message, json.error.code, json.error.error_subcode);
  return json;
}

export async function exchangeCodeForToken(code: string): Promise<{ access_token: string }> {
  return graphGet("/oauth/access_token", {
    client_id: getFbClientId(),
    client_secret: getFbClientSecret(),
    redirect_uri: getFbRedirectUri(),
    code,
  });
}

export async function exchangeForLongLivedToken(shortLivedToken: string): Promise<{ access_token: string }> {
  return graphGet("/oauth/access_token", {
    grant_type: "fb_exchange_token",
    client_id: getFbClientId(),
    client_secret: getFbClientSecret(),
    fb_exchange_token: shortLivedToken,
  });
}

// expires_at: unix seconds, 0 means "never expires" per Meta's own convention.
export async function debugToken(inputToken: string): Promise<{ expires_at: number; is_valid: boolean }> {
  const appToken = `${getFbClientId()}|${getFbClientSecret()}`;
  const json = await graphGet("/debug_token", { input_token: inputToken, access_token: appToken });
  return json.data;
}

export type FbPage = { id: string; name: string; access_token: string; category?: string };

export async function getUserPages(userAccessToken: string): Promise<FbPage[]> {
  const json = await graphGet("/me/accounts", { access_token: userAccessToken, limit: "100" });
  return (json.data ?? []) as FbPage[];
}

export async function getMe(userAccessToken: string): Promise<{ id: string; name?: string }> {
  return graphGet("/me", { access_token: userAccessToken, fields: "id,name" });
}

export async function publishToFeed(
  pageId: string,
  pageAccessToken: string,
  message: string
): Promise<{ id: string }> {
  return graphPost(`/${pageId}/feed`, { message, access_token: pageAccessToken });
}

export async function publishPhoto(
  pageId: string,
  pageAccessToken: string,
  imageUrl: string,
  message?: string
): Promise<{ id: string; post_id?: string }> {
  const params: Record<string, string> = { url: imageUrl, access_token: pageAccessToken };
  if (message) params.caption = message;
  return graphPost(`/${pageId}/photos`, params);
}

// 190 = invalid/expired OAuth token. 200/10 = permission errors (app or user lost access).
// Best-effort classification — used to proactively flag a connection as needs_reconnect rather
// than waiting solely on token_expires_at, since token revocation has no reliable push signal.
export function isTokenError(err: unknown): boolean {
  if (!(err instanceof MetaApiError)) return false;
  return err.code === 190 || err.code === 200 || err.code === 10;
}
