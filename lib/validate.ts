// Shared, isomorphic, no-I/O validators for values that cross the trust boundary from anonymous
// public input into this app's data — mirrors lib/images/validate.ts's shape (length cap checked
// BEFORE the regex runs, to avoid a ReDoS on a huge string).

export const MAX_EMAIL_CHARS = 254; // RFC 5321 practical cap
export const MAX_NAME_CHARS = 100;

// Pragmatic, not RFC 5322-exhaustive — good enough to reject garbage/malformed input from a public
// form without rejecting real addresses. Never used as the sole gate against abuse (see
// app/api/public/leads/route.ts's rate caps for that); this only guards data quality.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_EMAIL_CHARS) return false;
  return EMAIL_RE.test(value);
}

export function clampName(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.slice(0, MAX_NAME_CHARS).trim();
}

const MAX_REDIRECT_URL = 2000;

// Promoted out of app/api/funnel-steps/[id]/route.ts in Phase O.2 — now needed in three places
// (funnel-step CTA/decline redirects, and a freeform `button` block's href in
// lib/engine/validatePageBlockTree.ts). Tenant-supplied, not public input, but still becomes a
// real <a href> on the tenant's own page, so a cheap scheme allowlist avoids an accidental
// javascript:/data: self-XSS.
export function isValidRedirectUrl(v: unknown): v is string {
  return typeof v === "string" && v.length > 0 && v.length <= MAX_REDIRECT_URL && /^https?:\/\//i.test(v);
}
