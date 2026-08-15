// The app's own canonical origin, normalized once.
//
// This exists because of a build that died with `TypeError: Invalid URL` and `input: '****'` —
// the host's log redaction masking the offending value, so the error named neither the variable
// nor what was wrong with it. The cause was NEXT_PUBLIC_APP_URL set without a scheme.
//
// A malformed value here has TWO consequences, and the build failure is the milder one:
//
//   1. app/layout.tsx's `metadataBase: new URL(APP_URL)` runs at module scope, so `next build`
//      fails while collecting page data for the first page that imports the root layout.
//   2. Far worse if it ever gets past the build: lib/host.ts's hostConfigFromEnv() CATCHES the
//      same error and returns an empty appHost, so classifyHost() matches nothing and answers
//      "custom" for every request — middleware then rewrites every path to /d and the entire app
//      404s. CLAUDE.md records that happening for a full day after a rename.
//
// So the value is repaired rather than merely guarded: a missing scheme is added, a trailing
// slash and any path are dropped, and anything still unusable falls back to the canonical host.
// Falling back is right for the SEO/metadata readers this serves — a wrong-but-valid canonical
// URL is a cosmetic error, while throwing takes the site down. The OAuth config modules
// (lib/meta/config.ts, lib/tiktok/config.ts) deliberately keep their own "is not set" throw:
// a redirect URI silently defaulting to the wrong host fails at the provider, where it is much
// harder to diagnose than a clear error here.
//
// Read as a literal `process.env.NEXT_PUBLIC_APP_URL` expression: NEXT_PUBLIC_* is substituted at
// BUILD time by static analysis, so it can never be indexed dynamically.

// The APEX, not www. Netlify serves the apex as the site's primary domain and 301s www to it
// (measured 2026-08-15), so a www fallback would send every request through a redirect and print
// a canonical URL that redirects — and, worse, anything POSTed to www gets a 308 rather than
// reaching the route. This value must track whichever host Netlify has as primary.
export const DEFAULT_APP_URL = "https://affiliateoffersecrets.com";

// Only the two shapes anyone actually puts in this variable for dev. A bracketed IPv6 literal
// would need its own parsing and has never appeared here; it would fall through to https, which
// still yields a valid URL.
const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1"]);

/**
 * Turns whatever is in the env into a usable absolute origin, or the canonical default.
 *
 * Exported for its own tests and so callers can normalize a value from somewhere other than the
 * environment. Never throws.
 */
export function normalizeAppUrl(raw: string | null | undefined): string {
  // Deliberately NOT stripping a trailing slash here: doing that before the scheme test turns a
  // bare "https://" into "https:", which then looks scheme-less and gets one bolted on, yielding
  // the nonsense origin "https://https". Taking the origin below drops any path or trailing slash
  // anyway, so the strip was never needed. (Caught by a test, not by review.)
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return DEFAULT_APP_URL;

  // A scheme-less "www.example.com" or "example.com:3400" is the shape someone actually types
  // into a hosting dashboard. Assume https, except for local dev, where https would be the wrong
  // guess and nothing is listening on it.
  let candidate = trimmed;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate)) {
    const bare = candidate.split("/")[0].split(":")[0].toLowerCase();
    candidate = `${LOCAL_HOSTNAMES.has(bare) ? "http" : "https"}://${candidate}`;
  }

  try {
    const url = new URL(candidate);
    // Only http(s) can serve this app. A stray "ftp://" or "javascript:" is not a typo worth
    // honouring, and this value ends up in metadataBase and in canonical <link> tags.
    if (url.protocol !== "http:" && url.protocol !== "https:") return DEFAULT_APP_URL;
    if (!url.hostname) return DEFAULT_APP_URL;
    // Origin only. A path would silently change how metadataBase resolves every relative URL.
    return `${url.protocol}//${url.host}`;
  } catch {
    return DEFAULT_APP_URL;
  }
}

/** The canonical origin — always a valid absolute URL, safe to pass to `new URL()`. */
export const APP_URL = normalizeAppUrl(process.env.NEXT_PUBLIC_APP_URL);

/** Its host, lowercased, port included. What classifyHost compares an incoming Host against. */
export const APP_HOST = APP_URL.replace(/^https?:\/\//, "").toLowerCase();
