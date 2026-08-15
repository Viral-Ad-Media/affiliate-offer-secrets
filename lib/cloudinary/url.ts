// Delivery-URL helpers. ISOMORPHIC — no node:crypto, no I/O, no secrets — so the renderers in
// lib/engine/blockTree.ts and lib/blog.ts can import it. The signing client next door
// (lib/cloudinary/client.ts) is server-only and must never be pulled in from here.

import { isOwnCloudinaryUrl } from "@/lib/images/validate";

/**
 * Inserts a transformation into one of our delivery URLs.
 *
 * Returns the input UNCHANGED when it isn't one of ours — a legacy data URI, an empty string, or
 * anything else. That is what lets every render site call this unconditionally during the
 * migration: a page holding both a data URI and a Cloudinary URL renders correctly with one code
 * path, and nothing has to know which era a given row came from.
 *
 * A stored URL comes from the upload response's `secure_url`, which carries no transformation
 * (`…/image/upload/v1234/public_id.jpg`), so this is always inserting into a clean URL rather than
 * rewriting an existing transformation.
 *
 * `f_auto` lets Cloudinary negotiate AVIF/WebP from the browser's Accept header and `q_auto` picks
 * a quality — together they are most of the win over a base64 JPEG that every browser gets
 * identically. A width is added wherever the display size is known, because serving a 1600px hero
 * into a 400px card is the specific thing that made the blog index 4.1 MB.
 */
export function cloudinaryTransform(value: string | null | undefined, transform: string): string {
  if (!value || !isOwnCloudinaryUrl(value)) return value ?? "";
  if (!transform) return value;
  const marker = "/image/upload/";
  const at = value.indexOf(marker);
  if (at === -1) return value;
  const head = value.slice(0, at + marker.length);
  const tail = value.slice(at + marker.length);
  return `${head}${transform}/${tail}`;
}

// Named presets, so a width lives in one place rather than being retyped at each render site and
// drifting from the CSS that sizes the element.
//
// SYNTAX, from Cloudinary's own transformation reference — these were wrong on the first pass and
// the rules are not guessable:
//
//   1. Commas separate parameters WITHIN a component; slashes separate components. `f_` and `q_`
//      are separate ACTIONS, so `f_auto/q_auto` is correct and `f_auto,q_auto` is explicitly called
//      out as incorrect. Only one action parameter per component.
//   2. `f_auto/q_auto` goes at the END, after the resize, so the format is chosen for the final
//      pixels rather than the original.
//   3. Never use `w_`/`h_` without a crop mode. `c_limit` scales down only (never upscales a small
//      image); `c_fill` crops to exactly fill, and pairs with `g_auto` so the crop keeps the
//      subject rather than the middle.
//   4. Parameters are ordered alphabetically within a component, matching what the SDKs emit.
export const IMG_HERO = "c_limit,w_1200/f_auto/q_auto";
export const IMG_CARD = "c_fill,g_auto,h_300,w_400/f_auto/q_auto";
export const IMG_AVATAR = "c_fill,g_face,h_96,w_96/f_auto/q_auto";
/** Block-tree images have no fixed display size — format and quality only. */
export const IMG_BLOCK = "f_auto/q_auto";
