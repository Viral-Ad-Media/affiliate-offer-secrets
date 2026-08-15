// Cloudinary upload/delete. SERVER-ONLY — it reads the API secret and uses node:crypto.
//
// Never import this from a client component, or from an isomorphic module a client component
// imports (lib/engine/renderPages.ts and lib/engine/blockTree.ts are both in that category, and
// five editors import them). `tsc --noEmit` will NOT catch it; `next build` will. The same trap has
// bitten this codebase twice — BUILD_CAMPAIGN_STAGES dragging the Anthropic SDK into a bundle, and
// react-dom/server. The delivery-URL helpers live in ./url.ts precisely so the renderers have
// something safe to import.
//
// Shape mirrors lib/vercel/client.ts: private env getters that throw, a typed error carrying the
// status, one fetch wrapper.
//
// VERIFIED LIVE against api.cloudinary.com before this was written, with a known-bad control:
// a real cloud name with no auth answers 400 {"error":{"message":"Upload preset must be whitelisted
// for unsigned uploads"}}, while a nonexistent cloud answers 401 "Unknown API key" — different
// responses, so the probe measures something rather than returning a constant. The signed-upload
// parameter set and the response field names come from Cloudinary's upload API reference.

import { createHash } from "node:crypto";
import { cloudinaryCloudName } from "@/lib/images/validate";

const API_BASE = "https://api.cloudinary.com/v1_1";

export class CloudinaryError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "CloudinaryError";
    this.status = status;
  }
}

function getCloudName(): string {
  const v = cloudinaryCloudName();
  if (!v) throw new Error("NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME is not set");
  return v;
}

function getApiKey(): string {
  const v = process.env.CLOUDINARY_API_KEY;
  if (!v) throw new Error("CLOUDINARY_API_KEY is not set");
  return v;
}

function getApiSecret(): string {
  const v = process.env.CLOUDINARY_API_SECRET;
  if (!v) throw new Error("CLOUDINARY_API_SECRET is not set");
  return v;
}

/** Is Cloudinary configured at all? Lets a caller degrade to storing a data URI instead of throwing. */
export function isCloudinaryConfigured(): boolean {
  return !!(cloudinaryCloudName() && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET);
}

/**
 * SHA-1 over the signed params, sorted by key, joined `k=v` with `&`, with the API secret appended.
 *
 * `file`, `api_key`, `resource_type` and `cloud_name` are excluded from the signature — that is
 * Cloudinary's rule, not a choice here, and signing them produces a valid-looking request that is
 * rejected with an unhelpful error.
 */
function sign(params: Record<string, string>): string {
  const toSign = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");
  return createHash("sha1").update(`${toSign}${getApiSecret()}`).digest("hex");
}

/**
 * Correction for a local clock that disagrees with Cloudinary's.
 *
 * A signed upload carries a `timestamp`, and Cloudinary refuses one more than an hour from its own
 * time with "Stale request". That is not hypothetical: this was hit for real against a laptop whose
 * clock was **9.8 hours** behind after waking from sleep, and any long-lived server with drift fails
 * the same way — silently, on every upload, with an error that reads like a signing bug.
 *
 * So rather than trusting Date.now(), the first stale rejection reads the response's `Date` header,
 * records the offset, and retries. Cached for the process, because the drift does not change
 * between two requests a second apart, and re-deriving it per upload would double every call.
 *
 * Deliberately NOT a general retry: only a stale-timestamp rejection is retried, exactly once. A
 * rejected signature or a bad key must still fail immediately rather than being sent twice.
 */
let clockSkewSeconds = 0;

function nowSeconds(): string {
  return Math.floor(Date.now() / 1000 + clockSkewSeconds).toString();
}

function isStaleRequest(message: string | undefined): boolean {
  return !!message && /stale request/i.test(message);
}

/**
 * Retries a request that never reached Cloudinary at all.
 *
 * `fetch` rejects (rather than resolving with a status) for DNS and connection failures —
 * ENOTFOUND, ECONNRESET, a dropped TLS handshake. Observed here flapping on a seconds timescale:
 * curl succeeding and node failing a moment later against the same host. A backfill walking dozens
 * of rows over a link like that would otherwise abandon most of them.
 *
 * ONLY transport failures are retried. A resolved response — 400, 401, a rejected signature — is
 * returned untouched on the first attempt, because re-sending it would just fail identically and a
 * bad key should surface immediately rather than after three round trips.
 */
async function fetchWithRetry(url: string, init: RequestInit, attempts = 3): Promise<Response> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fetch(url, init);
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 500 * 2 ** i));
    }
  }
  throw lastErr;
}

/** Sets the offset from a response's Date header. Returns false if the header is unusable. */
function learnSkewFrom(res: Response): boolean {
  const header = res.headers.get("date");
  if (!header) return false;
  const remote = Date.parse(header);
  if (!Number.isFinite(remote)) return false;
  const skew = Math.round((remote - Date.now()) / 1000);
  if (Math.abs(skew) < 60) return false; // not a clock problem; don't mask a real signing bug
  clockSkewSeconds = skew;
  console.warn(`[cloudinary] local clock is ${skew}s from Cloudinary's — correcting and retrying`);
  return true;
}

export type UploadedImage = {
  publicId: string;
  secureUrl: string;
  bytes: number;
  format: string;
};

/**
 * Uploads an image and returns its delivery URL.
 *
 * `source` may be a base64 data URI — Cloudinary's `file` parameter accepts one directly (~60 MB
 * ceiling), which is why no path here converts to a Buffer or a Blob. Every existing write site in
 * this app already holds a data URI, so each one hands over exactly what it has.
 *
 * `folder` groups assets in the Cloudinary console (`aos/blog`, `aos/campaigns`, …). It is a
 * convenience for a human reading the dashboard, never an access control — deletion is tracked in
 * the `cloudinary_assets` table, not by folder.
 */
export async function uploadImage(
  source: string,
  opts: { folder: string; publicId?: string }
): Promise<UploadedImage> {
  const cloudName = getCloudName();

  const attempt = async () => {
    const signed: Record<string, string> = { folder: opts.folder, timestamp: nowSeconds() };
    if (opts.publicId) signed.public_id = opts.publicId;

    const form = new FormData();
    form.set("file", source);
    form.set("api_key", getApiKey());
    for (const [k, v] of Object.entries(signed)) form.set(k, v);
    form.set("signature", sign(signed));

    const res = await fetchWithRetry(`${API_BASE}/${cloudName}/image/upload`, { method: "POST", body: form });
    const json = (await res.json().catch(() => null)) as
      | { public_id?: string; secure_url?: string; bytes?: number; format?: string; error?: { message?: string } }
      | null;
    return { res, json };
  };

  let { res, json } = await attempt();

  // One retry, and only for a clock disagreement — see clockSkewSeconds above.
  if (!res.ok && isStaleRequest(json?.error?.message) && learnSkewFrom(res)) {
    ({ res, json } = await attempt());
  }

  // Cloudinary answers a real HTTP status, unlike TikTok's always-200 envelope — but the useful
  // message is in the body, so read both.
  if (!res.ok || !json?.secure_url || !json?.public_id) {
    throw new CloudinaryError(json?.error?.message ?? `Cloudinary upload failed (${res.status})`, res.status);
  }

  return {
    publicId: json.public_id,
    secureUrl: json.secure_url,
    bytes: json.bytes ?? 0,
    format: json.format ?? "",
  };
}

/**
 * Deletes an asset. Used by the account-deletion sweep.
 *
 * Cloudinary answers `{result:"not found"}` with a 200 for an id that is already gone; that is
 * treated as success, because a cleanup path must be re-runnable and "already deleted" is the
 * outcome it wanted.
 */
export async function destroyImage(publicId: string): Promise<void> {
  const cloudName = getCloudName();

  const attempt = async () => {
    const timestamp = nowSeconds();
    const signed = { public_id: publicId, timestamp };

    const form = new FormData();
    form.set("api_key", getApiKey());
    form.set("public_id", publicId);
    form.set("timestamp", timestamp);
    form.set("signature", sign(signed));

    const res = await fetchWithRetry(`${API_BASE}/${cloudName}/image/destroy`, { method: "POST", body: form });
    const json = (await res.json().catch(() => null)) as { result?: string; error?: { message?: string } } | null;
    return { res, json };
  };

  let { res, json } = await attempt();
  // Same clock-skew retry as upload — a deletion sweep failing on drift would strand real assets.
  if (!res.ok && isStaleRequest(json?.error?.message) && learnSkewFrom(res)) {
    ({ res, json } = await attempt());
  }
  if (!res.ok && json?.result !== "not found") {
    throw new CloudinaryError(json?.error?.message ?? `Cloudinary destroy failed (${res.status})`, res.status);
  }
}
