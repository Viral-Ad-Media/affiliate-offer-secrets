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

// AI-generated ad creatives (kie.ai) are full-resolution photographs, not small vendor product
// shots — real output observed at ~2.7MB decoded, well over the 200KB cap above. Same allowlist
// regex, just a larger ceiling for this one call site (lib/engine/adimage.ts's stageFinalize).
export const MAX_AD_IMAGE_DATA_URL_CHARS = 14_000_000; // ~10MB decoded

export const IMAGE_DATA_URL_RE = /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/]+=*$/;

export function isValidImageDataUrl(value: unknown, maxLen: number = MAX_IMAGE_DATA_URL_CHARS): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLen) return false;
  return IMAGE_DATA_URL_RE.test(value);
}

// ---------------------------------------------------------------------------------------------
// Cloudinary-hosted images
// ---------------------------------------------------------------------------------------------

// Deliberately anchored to OUR OWN cloud, never "any https URL".
//
// This is the whole security story of moving images off data: URIs. Until now the stored value
// could only be bytes we already held, so an <img src> on a page served to anonymous ad traffic
// could not point anywhere — that property came for free from the data:-only rule, and it has to
// survive the change. Accepting arbitrary URLs would hand every tenant a way to hotlink, to embed
// a tracking pixel on a page carrying someone else's disclosure, and to make our pages issue
// requests to a host of their choosing.
//
// The cloud name is NEXT_PUBLIC_ because it genuinely is public — it appears in every delivery URL
// a browser loads. Same reasoning FB_LOGIN_CONFIG_ID is documented as not-a-secret. The API key and
// secret stay server-only, in lib/cloudinary/client.ts.
//
// Shape: https://res.cloudinary.com/{cloud}/image/upload/{transformations?}/{version?}/{public_id}.{fmt}
// The character class covers transformation segments (`f_auto,q_auto,w_400`), folders, versions and
// the public id. It does NOT include `:` or `@`, so no credentials or port can be smuggled into the
// authority, and the anchored `^https://res\.cloudinary\.com/` means a lookalike host like
// `res.cloudinary.com.evil.test` cannot match.
const CLOUDINARY_PATH_RE = /^[A-Za-z0-9_,\-./]+$/;
const MAX_CLOUDINARY_URL_CHARS = 2000;

export function cloudinaryCloudName(): string {
  return (process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME ?? "").trim();
}

export function isOwnCloudinaryUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_CLOUDINARY_URL_CHARS) {
    return false;
  }
  const cloud = cloudinaryCloudName();
  // No configured cloud means no URL can be ours. Fail CLOSED — the alternative would accept
  // anything shaped like a Cloudinary URL on a deployment that has not been set up.
  if (!cloud || !CLOUDINARY_PATH_RE.test(cloud)) return false;
  const prefix = `https://res.cloudinary.com/${cloud}/image/upload/`;
  if (!value.startsWith(prefix)) return false;
  const rest = value.slice(prefix.length);
  return rest.length > 0 && CLOUDINARY_PATH_RE.test(rest);
}

/**
 * Either shape an image column may hold: a legacy inline data URI, or one of our Cloudinary URLs.
 *
 * Both remain valid indefinitely — the backfill converts existing rows, but nothing forces a row to
 * be converted, and a caller that still produces a data URI keeps working. That is what lets this
 * ship without a flag day.
 *
 * `maxLen` applies only to the data-URI branch, which is the one that can be enormous; a URL is
 * bounded by MAX_CLOUDINARY_URL_CHARS regardless of what the caller passes.
 */
export function isValidImageRef(value: unknown, maxLen: number = MAX_IMAGE_DATA_URL_CHARS): value is string {
  return isValidImageDataUrl(value, maxLen) || isOwnCloudinaryUrl(value);
}
