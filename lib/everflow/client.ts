// Everflow affiliate API. Server-only — the API key is a bearer secret and never reaches a client
// component.
//
// Everything below the type definitions was verified live against the real API before it was
// written (the discipline this codebase applies to every external integration):
//
//   GET /v1/affiliates/offersrunnable   → 401 "Unable to authenticate request"   (exists)
//   GET /v1/affiliates/offers/{id}      → 401 "Unable to authenticate request"   (exists)
//   GET /v1/affiliates/<nonsense>       → 404 "Not Found"                        (control)
//
// The 404 control is what makes the 401s meaningful: unknown paths are rejected differently, so a
// 401 really does mean "this endpoint exists, you're just not authenticated".
//
// One key covers both the affiliate and the network they belong to — there is no separate tenant
// parameter anywhere in the path or query, which is what makes a single adapter reach every
// network running on the Everflow platform.

export const EVERFLOW_API_BASE = "https://api.eflow.team/v1";

export class EverflowApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly isAuthError: boolean
  ) {
    super(message);
    this.name = "EverflowApiError";
  }
}

async function efFetch<T>(apiKey: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${EVERFLOW_API_BASE}${path}`, {
    ...init,
    headers: {
      // Documented header for the Everflow API. Note a wrong key and a missing key are
      // indistinguishable from outside (both 401), so "did this key work" can only be answered by
      // a real request — which is exactly what verifyApiKey below does at connect time.
      "X-Eflow-API-Key": apiKey,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });

  const text = await res.text();
  if (!res.ok) {
    let message = text.slice(0, 300);
    try {
      message = (JSON.parse(text) as { Error?: string }).Error ?? message;
    } catch {
      // Non-JSON error body (gateway HTML, etc.) — the truncated text is the best available.
    }
    throw new EverflowApiError(message || `Everflow request failed (${res.status})`, res.status, res.status === 401 || res.status === 403);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

// Shape confirmed from Everflow's own docs for the single-offer endpoint. Every field is optional
// here because the LIST endpoint's exact envelope and field coverage could not be verified without
// a real key — see extractOffers() below.
export type EverflowOffer = {
  network_offer_id?: number;
  name?: string;
  offer_status?: string;
  network_category_id?: number;
  preview_url?: string;
  tracking_url?: string;
  html_description?: string;
  currency_id?: string;
};

// The list response envelope is the one thing a fake key can't reveal: 401 tells us the endpoint
// exists but not what a success body looks like. Rather than guess one shape and ship a parser
// that silently returns nothing, accept the handful of shapes an API of this kind uses and fail
// loudly if it's none of them.
export function extractOffers(payload: unknown): EverflowOffer[] {
  if (Array.isArray(payload)) return payload as EverflowOffer[];
  const obj = (payload ?? {}) as Record<string, unknown>;
  for (const key of ["offers", "data", "Offers", "results"]) {
    const v = obj[key];
    if (Array.isArray(v)) return v as EverflowOffer[];
  }
  throw new EverflowApiError(
    "Everflow returned an offer list in an unrecognized shape — the adapter needs updating for this response",
    200,
    false
  );
}

// Offers this affiliate is approved to run. `page`/`page_size` follow Everflow's paging convention;
// if this account's instance ignores them the caller still gets the first page, which is safe.
export async function listRunnableOffers(
  apiKey: string,
  opts: { page?: number; pageSize?: number } = {}
): Promise<EverflowOffer[]> {
  const params = new URLSearchParams({
    page: String(opts.page ?? 1),
    page_size: String(opts.pageSize ?? 50),
  });
  const payload = await efFetch<unknown>(apiKey, `/affiliates/offersrunnable?${params}`);
  return extractOffers(payload);
}

export async function getOffer(apiKey: string, offerId: number | string): Promise<EverflowOffer> {
  return efFetch<EverflowOffer>(apiKey, `/affiliates/offers/${encodeURIComponent(String(offerId))}`);
}

// Proves a key works before it's stored, and doubles as the "is this connection still good" check.
// Any 401/403 means the key is wrong or revoked; anything else is a transport problem and is
// reported as such rather than being blamed on the user's key.
export async function verifyApiKey(apiKey: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    await efFetch<unknown>(apiKey, "/affiliates/offersrunnable?page=1&page_size=1");
    return { ok: true };
  } catch (err) {
    if (err instanceof EverflowApiError && err.isAuthError) {
      return { ok: false, reason: "Everflow rejected that API key. Check you copied it from your network's affiliate portal." };
    }
    return { ok: false, reason: err instanceof Error ? err.message : "Could not reach Everflow" };
  }
}

// Everflow tracking links are built from the network's own tracking domain, which varies per
// network — it is NOT api.eflow.team. The offer payload carries the ready-made `tracking_url`, so
// the affiliate id and sub-id are appended to that rather than a base URL being invented here.
export function buildEverflowTrackingUrl(
  trackingUrl: string,
  affiliateId: string,
  subId: string
): string {
  try {
    const url = new URL(trackingUrl);
    if (!url.searchParams.has("affiliate_id")) url.searchParams.set("affiliate_id", affiliateId);
    // sub1 is Everflow's conventional per-channel slot — the same job this app's `tid` does for
    // ClickBank.
    url.searchParams.set("sub1", subId);
    return url.toString();
  } catch {
    // A malformed tracking_url is the network's data, not something to crash a build over.
    return trackingUrl;
  }
}
