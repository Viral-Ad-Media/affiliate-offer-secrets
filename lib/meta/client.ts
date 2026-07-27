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

// expires_at: unix seconds, 0 means "never expires" per Meta's own convention. scopes lists what
// was ACTUALLY granted — Meta's consent dialog allows declining individual permissions, so a
// successful token exchange never guarantees a requested scope was granted; callers must check.
export async function debugToken(
  inputToken: string
): Promise<{ expires_at: number; is_valid: boolean; scopes: string[] }> {
  const appToken = `${getFbClientId()}|${getFbClientSecret()}`;
  const json = await graphGet("/debug_token", { input_token: inputToken, access_token: appToken });
  return { ...json.data, scopes: json.data?.scopes ?? [] };
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

function dataUrlToBlob(dataUrl: string): { blob: Blob; mime: string } {
  const match = dataUrl.match(/^data:([^;]+);base64,([\s\S]*)$/);
  if (!match) throw new Error("Expected a base64 data URL");
  const [, mime, base64] = match;
  const bytes = Buffer.from(base64, "base64");
  return { blob: new Blob([bytes], { type: mime }), mime };
}

// Uploads real image bytes rather than hotlinking a third-party URL — vendor CDNs commonly block
// unknown-fetcher requests, the vendor can swap the image later, and hotlinking a third party's
// asset into a live post is more exposed than embedding a copy (same reasoning CLAUDE.md's
// content rule 9 already applies to presell pages). Callers get the bytes via
// lib/engine/images.ts's fetchImageAsDataUrl(), same helper the presell page embed already uses.
export async function publishPhotoBytes(
  pageId: string,
  pageAccessToken: string,
  imageDataUrl: string,
  message?: string
): Promise<{ id: string; post_id?: string }> {
  const { blob } = dataUrlToBlob(imageDataUrl);
  const form = new FormData();
  form.append("source", blob, "image.jpg");
  form.append("access_token", pageAccessToken);
  if (message) form.append("caption", message);

  const res = await fetch(`${FB_GRAPH_BASE}/${pageId}/photos`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(20_000),
  });
  const json = await res.json();
  if (json.error) throw new MetaApiError(json.error.message, json.error.code, json.error.error_subcode);
  return json;
}

// --- Instagram Graph API (Phase E) ---

// IG Business actions are authorized via the LINKED PAGE's own access token — there is no
// separate Instagram-specific token. Returns null if this Page has no linked IG Business account.
export async function getLinkedInstagramAccount(
  pageId: string,
  pageAccessToken: string
): Promise<{ id: string; username: string } | null> {
  const json = await graphGet(`/${pageId}`, {
    fields: "instagram_business_account{id,username}",
    access_token: pageAccessToken,
  });
  return json.instagram_business_account ?? null;
}

// Step 1 of Instagram's 2-step publish flow. image_url must be a real, publicly-fetchable HTTPS
// URL (unlike Facebook's Photos API, IG does not accept direct byte upload) — see
// app/api/public/campaign-image for how that URL is produced.
export async function createIgMediaContainer(
  igUserId: string,
  pageAccessToken: string,
  imageUrl: string,
  caption: string
): Promise<{ id: string }> {
  return graphPost(`/${igUserId}/media`, {
    image_url: imageUrl,
    caption,
    access_token: pageAccessToken,
  });
}

// Reels variant of createIgMediaContainer — media_type: "REELS" + video_url instead of
// image_url. Container processing is async on Meta's side (re-encoding); poll status via
// getIgContainerStatus() before calling publishIgMedia().
export async function createIgReelContainer(
  igUserId: string,
  pageAccessToken: string,
  videoUrl: string,
  caption: string
): Promise<{ id: string }> {
  return graphPost(`/${igUserId}/media`, {
    media_type: "REELS",
    video_url: videoUrl,
    caption,
    access_token: pageAccessToken,
  });
}

// "EXPIRED" | "ERROR" | "FINISHED" | "IN_PROGRESS" | "PUBLISHED"
export async function getIgContainerStatus(
  containerId: string,
  pageAccessToken: string
): Promise<string> {
  const json = await graphGet(`/${containerId}`, {
    fields: "status_code",
    access_token: pageAccessToken,
  });
  return json.status_code as string;
}

export async function publishIgMedia(
  igUserId: string,
  pageAccessToken: string,
  creationId: string
): Promise<{ id: string }> {
  return graphPost(`/${igUserId}/media_publish`, {
    creation_id: creationId,
    access_token: pageAccessToken,
  });
}

// --- Marketing API (Phase C: ad campaign launch) ---

export async function getAdAccounts(
  userAccessToken: string
): Promise<{ id: string; name: string; currency: string }[]> {
  const json = await graphGet("/me/adaccounts", {
    access_token: userAccessToken,
    fields: "id,name,currency",
    limit: "100",
  });
  return json.data ?? [];
}

// Uploads real bytes to Meta's own image store and returns a stable image_hash — never
// image_url pointing at a third-party host, for the same hotlinking reasons as
// publishPhotoBytes above. adAccountId includes the "act_" prefix.
export async function uploadAdImage(
  adAccountId: string,
  userAccessToken: string,
  imageDataUrl: string
): Promise<string> {
  const match = imageDataUrl.match(/^data:[^;]+;base64,([\s\S]*)$/);
  if (!match) throw new Error("Expected a base64 data URL");
  const json = await graphPost(`/${adAccountId}/adimages`, {
    bytes: match[1],
    access_token: userAccessToken,
  });
  const first = Object.values(json.images ?? {})[0] as { hash?: string } | undefined;
  if (!first?.hash) throw new MetaApiError("No image hash returned from Meta");
  return first.hash;
}

// Created PAUSED — Meta's own default for new Campaign/AdSet/Ad objects, which is what makes
// "PAUSED-until-confirmed launch" free instead of something this app has to invent.
export async function createCampaign(
  adAccountId: string,
  userAccessToken: string,
  opts: { name: string; dailyBudgetCents: number }
): Promise<{ id: string }> {
  return graphPost(`/${adAccountId}/campaigns`, {
    name: opts.name,
    objective: "OUTCOME_TRAFFIC",
    buying_type: "AUCTION",
    status: "PAUSED",
    daily_budget: String(opts.dailyBudgetCents),
    special_ad_categories: "[]",
    access_token: userAccessToken,
  });
}

// No budget field here — the parent campaign uses CBO (campaign-level daily_budget), and Meta
// rejects an ad-set-level budget under a CBO parent.
export async function createAdSet(
  adAccountId: string,
  userAccessToken: string,
  opts: { name: string; campaignId: string; country: string }
): Promise<{ id: string }> {
  return graphPost(`/${adAccountId}/adsets`, {
    name: opts.name,
    campaign_id: opts.campaignId,
    billing_event: "IMPRESSIONS",
    optimization_goal: "LINK_CLICKS",
    targeting: JSON.stringify({ geo_locations: { countries: [opts.country] } }),
    status: "PAUSED",
    access_token: userAccessToken,
  });
}

export async function createAdCreative(
  adAccountId: string,
  userAccessToken: string,
  opts: { name: string; pageId: string; imageHash: string; linkUrl: string; message: string; headline: string }
): Promise<{ id: string }> {
  return graphPost(`/${adAccountId}/adcreatives`, {
    name: opts.name,
    object_story_spec: JSON.stringify({
      page_id: opts.pageId,
      link_data: {
        link: opts.linkUrl,
        message: opts.message,
        name: opts.headline,
        image_hash: opts.imageHash,
      },
    }),
    access_token: userAccessToken,
  });
}

export async function createAd(
  adAccountId: string,
  userAccessToken: string,
  opts: { name: string; adsetId: string; creativeId: string }
): Promise<{ id: string }> {
  return graphPost(`/${adAccountId}/ads`, {
    name: opts.name,
    adset_id: opts.adsetId,
    creative: JSON.stringify({ creative_id: opts.creativeId }),
    status: "PAUSED",
    access_token: userAccessToken,
  });
}

// Same endpoint shape for campaign/adset/ad — Meta's API is homogeneous here, just POST /{id}
// with a status field. Used both to activate (PAUSED→ACTIVE) and to compensate a partial
// activation failure by re-pausing whatever did go live.
export async function setEntityStatus(
  entityId: string,
  userAccessToken: string,
  status: "ACTIVE" | "PAUSED"
): Promise<{ success: boolean }> {
  return graphPost(`/${entityId}`, { status, access_token: userAccessToken });
}

// 190 = invalid/expired OAuth token. 200/10 = permission errors (app or user lost access).
// Best-effort classification — used to proactively flag a connection as needs_reconnect rather
// than waiting solely on token_expires_at, since token revocation has no reliable push signal.
export function isTokenError(err: unknown): boolean {
  if (!(err instanceof MetaApiError)) return false;
  return err.code === 190 || err.code === 200 || err.code === 10;
}
