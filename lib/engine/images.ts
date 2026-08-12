import { completeJSON, type UsageContext } from "./anthropic";
import { BROWSER_UA } from "./clickbank";
import type { ImageCandidate } from "./salespage";
import { ALLOWED_IMAGE_CONTENT_TYPES } from "../images/validate";

const MAX_IMAGE_BYTES = 200 * 1024; // keep pages well under 200KB per content rule
// Across ALL images on one page. See fetchImagesWithBudget.
const MAX_TOTAL_IMAGE_BYTES = 420 * 1024;

// LLM picks the single best neutral product shot (bottle/box/cover/screenshot) — never a
// testimonial/people photo — from the candidates found on the sales page, or none if nothing
// qualifies. See CLAUDE.md content rule 9.
/**
 * Up to `max` neutral product shots, best first.
 *
 * Was a single pick. Generated pages now place images in more than one section, and asking the
 * same call for a ranked list costs a handful of extra output tokens rather than another request
 * — the alternative (take the model's one pick, then grab the next raw candidates) would defeat
 * the point of asking at all: the candidate list is every <img> on a sales page, so the ones the
 * model did NOT choose are exactly the logos, spacers and testimonial faces content rule 9 exists
 * to keep off the page.
 */
export async function pickProductImages(
  candidates: ImageCandidate[],
  productTitle: string,
  max: number,
  usage?: UsageContext
): Promise<ImageCandidate[]> {
  if (candidates.length === 0 || max < 1) return [];

  const result = await completeJSON<{ indexes: number[] | null }>({
    system:
      "You select product images for affiliate marketing pages. Pick only neutral product photography — a bottle/box/package shot, an ebook/guide cover mockup, or a screenshot of the actual app/dashboard/interface. Never pick a photo of a person (testimonials, 'customer' photos, before/after imagery, stock models). Order them best first. Return only the ones that genuinely qualify — fewer is better than padding the list, and an empty list is correct when nothing does.",
    prompt: `Product: "${productTitle}"\n\nPick up to ${max} images.\n\nCandidate images (index, URL, alt text):\n${candidates
      .map((c, i) => `${i}: ${c.url}  alt="${c.alt}"`)
      .join("\n")}`,
    schema: {
      type: "object",
      properties: {
        indexes: {
          type: ["array", "null"],
          items: { type: "integer" },
          maxItems: max,
          description: "Indexes of the best candidates, best first. Empty or null if none qualify.",
        },
      },
      required: ["indexes"],
    },
    maxTokens: 300,
    usage,
  });

  const seen = new Set<number>();
  return (result.indexes ?? [])
    .filter((i) => Number.isInteger(i) && !seen.has(i) && seen.add(i) !== undefined)
    .map((i) => candidates[i])
    .filter((c): c is ImageCandidate => !!c)
    .slice(0, max);
}

/** Back-compat wrapper — one image, the model's first choice. */
export async function pickProductImage(
  candidates: ImageCandidate[],
  productTitle: string,
  usage?: UsageContext
): Promise<ImageCandidate | null> {
  return (await pickProductImages(candidates, productTitle, 1, usage))[0] ?? null;
}

/**
 * Fetches several images, stopping at a TOTAL byte budget.
 *
 * Every image here is base64-inlined into both `page_copy` and the rendered `bridge_html`, so it
 * is paid for twice in the database and once again on every page load. Campaign rows already
 * average 166 kB; three unbudgeted 200 kB images would more than triple that and slow the one
 * page whose load time directly costs conversions. The per-image cap alone does not bound the
 * total, so the total is bounded here.
 */
export async function fetchImagesWithBudget(
  urls: string[],
  totalBytes = MAX_TOTAL_IMAGE_BYTES
): Promise<string[]> {
  const out: string[] = [];
  let spent = 0;
  for (const url of urls) {
    const dataUrl = await fetchImageAsDataUrl(url);
    if (!dataUrl) continue;
    // The base64 payload's own length is what actually ships, not the decoded size.
    const cost = dataUrl.length;
    if (spent + cost > totalBytes) continue;
    spent += cost;
    out.push(dataUrl);
  }
  return out;
}

export async function fetchImageAsDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": BROWSER_UA },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    // Allowlist, not a bare "image/*" prefix check — svg+xml can carry inline <script> and this
    // value later gets served standalone (app/api/public/campaign-image), not just embedded in
    // an <img src>. See lib/images/validate.ts for why this must stay in sync everywhere.
    const contentType = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!ALLOWED_IMAGE_CONTENT_TYPES.includes(contentType)) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength === 0 || buf.byteLength > MAX_IMAGE_BYTES) return null;
    return `data:${contentType};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}
