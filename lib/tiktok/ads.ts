import {
  TIKTOK_ADS_API_BASE,
  getTiktokAdsAppId,
  getTiktokAdsSecret,
} from "@/lib/tiktok/adsConfig";

/**
 * TikTok Marketing API client.
 *
 * EVERY SHAPE BELOW WAS PROBED AGAINST THE LIVE API on 2026-08-06 rather than written from
 * memory — the same rule this codebase already applied to ClickBank's GraphQL, kie.ai, Gemini and
 * Meta's video-ad endpoints, and the rule that caused Digistore24 discovery to be parked rather
 * than guessed at. What was confirmed:
 *
 *   - Base `https://business-api.tiktok.com/open_api/v1.3`.
 *   - Auth is an `Access-Token` HEADER. Not `Authorization: Bearer` — sending Bearer yields
 *     40104 "Access token is null, you should set it in http header with key Access-Token."
 *   - Every response is `{code, message, request_id, data}` with code 0 for success. HTTP status
 *     is 200 even for errors, so `res.ok` means nothing here — `code` is the only signal.
 *   - `oauth2/access_token/` is POST JSON and requires `app_id` (an int64 — a non-numeric value
 *     is rejected with a Go strconv.ParseInt error), `secret`, `auth_code`, `grant_type`.
 *   - `oauth2/advertiser/get/` is GET.
 *   - `campaign/create/`, `adgroup/create/`, `ad/create/`, `file/video/ad/upload/` are POST-only
 *     (GET returns a bare 405 HTML page, not the JSON envelope).
 *   - Codes seen: 40002 invalid/missing params, 40104 missing token, 40105 bad/revoked token.
 *
 * NOT verified, and deliberately not written here: the field-level bodies for campaign/adgroup/ad
 * creation. Those endpoints reject every unauthenticated probe with 40105, so their required
 * fields and enum values (objective_type, budget_mode, optimization_goal, placements, targeting)
 * cannot be confirmed without a real advertiser token. Guessing them is how you ship something
 * that looks right and fails — or worse, spends — on first contact. They belong in a follow-up
 * once a real TikTok for Business advertiser account exists to probe against.
 */

export class TiktokAdsApiError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly requestId?: string
  ) {
    super(message);
    this.name = "TiktokAdsApiError";
  }
}

/**
 * A token problem rather than a bad request — the caller should flip the connection to
 * `needs_reconnect` instead of retrying, exactly as `isTokenError()` does for Meta.
 */
export function isTiktokAdsTokenError(err: unknown): boolean {
  return err instanceof TiktokAdsApiError && (err.code === 40104 || err.code === 40105);
}

type Envelope<T> = { code: number; message: string; request_id?: string; data: T };

async function call<T>(
  path: string,
  opts: { method?: "GET" | "POST"; accessToken?: string; body?: unknown; query?: Record<string, string> }
): Promise<T> {
  const url = new URL(`${TIKTOK_ADS_API_BASE}/${path.replace(/^\/+/, "")}`);
  for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, v);

  const res = await fetch(url.toString(), {
    method: opts.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      ...(opts.accessToken ? { "Access-Token": opts.accessToken } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    cache: "no-store",
  });

  const text = await res.text();
  let parsed: Envelope<T>;
  try {
    parsed = JSON.parse(text);
  } catch {
    // A non-JSON body means we hit something that isn't the API surface at all — a 405 HTML page
    // from using the wrong verb, or the edge rate-limiting a burst (observed while probing).
    throw new TiktokAdsApiError(-1, `Non-JSON response from ${path} (HTTP ${res.status})`);
  }

  // HTTP 200 with a non-zero code is the normal failure shape, so this is the real check.
  if (parsed.code !== 0) {
    throw new TiktokAdsApiError(parsed.code, parsed.message || `TikTok API error ${parsed.code}`, parsed.request_id);
  }
  return parsed.data;
}

export type TiktokAdsToken = {
  access_token: string;
  refresh_token?: string;
  advertiser_ids?: string[];
  scope?: number[];
  expires_in?: number;
};

/** Exchange the portal's `auth_code` for an advertiser-scoped token. */
export async function exchangeTiktokAdsAuthCode(authCode: string): Promise<TiktokAdsToken> {
  return call<TiktokAdsToken>("oauth2/access_token/", {
    method: "POST",
    body: {
      app_id: getTiktokAdsAppId(),
      secret: getTiktokAdsSecret(),
      auth_code: authCode,
      grant_type: "auth_code",
    },
  });
}

export type TiktokAdvertiser = { advertiser_id: string; advertiser_name?: string };

/**
 * The advertisers this token may act on. Note it takes app_id/secret as QUERY params AND the token
 * as a header — an unusual combination, and the reason this isn't a generic authed GET helper.
 */
export async function listTiktokAdvertisers(accessToken: string): Promise<TiktokAdvertiser[]> {
  const data = await call<{ list?: TiktokAdvertiser[] }>("oauth2/advertiser/get/", {
    method: "GET",
    accessToken,
    query: { app_id: getTiktokAdsAppId(), secret: getTiktokAdsSecret() },
  });
  return data.list ?? [];
}
