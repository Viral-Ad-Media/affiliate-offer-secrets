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
