import { completeJSON } from "./anthropic";
import { BROWSER_UA } from "./clickbank";
import type { ImageCandidate } from "./salespage";

const MAX_IMAGE_BYTES = 200 * 1024; // keep pages well under 200KB per content rule

// LLM picks the single best neutral product shot (bottle/box/cover/screenshot) — never a
// testimonial/people photo — from the candidates found on the sales page, or none if nothing
// qualifies. See CLAUDE.md content rule 9.
export async function pickProductImage(
  candidates: ImageCandidate[],
  productTitle: string
): Promise<ImageCandidate | null> {
  if (candidates.length === 0) return null;

  const result = await completeJSON<{ index: number | null }>({
    system:
      "You select product images for affiliate marketing pages. Pick only neutral product photography — a bottle/box/package shot, an ebook/guide cover mockup, or a screenshot of the actual app/dashboard/interface. Never pick a photo of a person (testimonials, 'customer' photos, before/after imagery, stock models). If nothing in the list qualifies, return null.",
    prompt: `Product: "${productTitle}"\n\nCandidate images (index, URL, alt text):\n${candidates
      .map((c, i) => `${i}: ${c.url}  alt="${c.alt}"`)
      .join("\n")}`,
    schema: {
      type: "object",
      properties: {
        index: { type: ["integer", "null"], description: "Index of the best candidate, or null" },
      },
      required: ["index"],
    },
    maxTokens: 200,
  });

  if (result.index == null) return null;
  return candidates[result.index] ?? null;
}

export async function fetchImageAsDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": BROWSER_UA },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.startsWith("image/")) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength === 0 || buf.byteLength > MAX_IMAGE_BYTES) return null;
    return `data:${contentType};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}
