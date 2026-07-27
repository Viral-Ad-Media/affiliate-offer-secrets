// Shared image content-type allowlist — isomorphic, no I/O. Used at three points that must never
// drift apart: fetching a vendor image server-side (lib/engine/images.ts), validating a
// client-submitted image in the no-code editor (app/api/campaigns/[id]/page-copy/route.ts), and
// re-validating a stored value before serving it standalone (app/api/public/campaign-image).
// Deliberately excludes image/svg+xml — an SVG served/fetched as a top-level or embedded document
// can execute inline <script>, unlike a raster image; a data: URL embedded only in an <img src>
// is comparatively low-risk, but this value is served standalone elsewhere, so treat SVG as
// unsafe everywhere rather than tracking two different trust levels for the same value.
export const ALLOWED_IMAGE_CONTENT_TYPES = ["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"];

// Length cap checked BEFORE the regex runs, to avoid a ReDoS on a huge string.
export const MAX_IMAGE_DATA_URL_CHARS = 280_000; // ~200KB decoded, matching MAX_IMAGE_BYTES

export const IMAGE_DATA_URL_RE = /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/]+=*$/;

export function isValidImageDataUrl(value: unknown, maxLen: number = MAX_IMAGE_DATA_URL_CHARS): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLen) return false;
  return IMAGE_DATA_URL_RE.test(value);
}
