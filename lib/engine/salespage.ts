import * as cheerio from "cheerio";
import { BROWSER_UA } from "./clickbank";

export type ImageCandidate = { url: string; alt: string };

export type SalesPage = {
  ok: boolean;
  text: string | null;
  imageCandidates: ImageCandidate[];
  /** Hex colours found in the page's own styles, most-used first. See extractBrandColors. */
  brandColors: string[];
  /** The vendor's own heading typeface and button shape, as our own closed enums. */
  brandStyle: BrandStyle;
};

/**
 * The parts of a vendor's look that can be copied SAFELY.
 *
 * Both fields are members of an enum this codebase already defines, never a string lifted off the
 * page — a font-family read from a sales page is attacker-influenced text heading for a `style`
 * attribute, and this codebase's whole approach to styling is that only enums and clamped numbers
 * reach CSS. So the extractor's job is classification, not copying: it decides which of five
 * typefaces and three button shapes the page most resembles, and that choice is all that travels.
 */
export type BrandStyle = {
  headingFont?: "system" | "serif" | "mono" | "rounded" | "condensed";
  buttonShape?: "rounded" | "pill" | "square";
};

// Families a sales page actually names, grouped by what they read as. Matched case-insensitively
// against every font-family declaration; the group with the most hits wins.
const FONT_GROUPS: { font: NonNullable<BrandStyle["headingFont"]>; families: string[] }[] = [
  { font: "serif", families: ["georgia", "garamond", "playfair", "merriweather", "lora", "times", "baskerville", "cormorant", "serif"] },
  { font: "rounded", families: ["nunito", "quicksand", "poppins", "comfortaa", "varela", "rubik", "baloo"] },
  { font: "condensed", families: ["oswald", "bebas", "anton", "roboto condensed", "barlow condensed", "fjalla", "teko"] },
  { font: "mono", families: ["courier", "monaco", "consolas", "roboto mono", "space mono", "monospace"] },
];

/**
 * Classifies the vendor's heading typeface and button roundness from its raw markup.
 *
 * Deliberately crude. It reads every `font-family` and `border-radius` in the document rather than
 * trying to work out which rules apply to headings and buttons specifically — resolving that
 * properly needs a real CSS cascade against a rendered DOM, which is a different program. What
 * comes out is a rough impression of the page, which is exactly what is wanted: enough that a
 * serif, editorial sales page produces a serif bridge page and a chunky rounded one produces
 * pill buttons.
 *
 * `serif` deliberately sits last in its own group's match list so a page naming a specific serif
 * scores it once, not twice.
 */
export function extractBrandStyle(html: string): BrandStyle {
  const lower = html.toLowerCase();
  const out: BrandStyle = {};

  const families: string[] = [];
  // Quotes are NOT excluded from the capture: `font-family:'Playfair Display',Georgia,serif` is
  // the common shape, and stopping at the first quote captured nothing at all. Nothing from this
  // string is ever emitted — it is only substring-matched against the known families above — so
  // what it contains doesn't matter, only that the whole declaration is visible to the match.
  const famRe = /font-family\s*:\s*([^;}]{0,200})/gi;
  for (let m = famRe.exec(lower); m; m = famRe.exec(lower)) families.push(m[1]);
  if (families.length > 0) {
    const joined = families.join(" | ");
    let best: { font: NonNullable<BrandStyle["headingFont"]>; hits: number } | null = null;
    for (const group of FONT_GROUPS) {
      const hits = group.families.reduce(
        (n, f) => n + (joined.split(f).length - 1),
        0
      );
      if (hits > 0 && (!best || hits > best.hits)) best = { font: group.font, hits };
    }
    // Only override the default when the page leans one way clearly. A single mention among
    // dozens of declarations is noise, not a style.
    if (best && best.hits >= 2) out.headingFont = best.font;
  }

  // Button roundness, from the radii the page actually uses. The median resists one stray
  // `border-radius: 50%` on an avatar dragging every page to "pill".
  const radii: number[] = [];
  const radRe = /border-radius\s*:\s*(\d{1,3})px/gi;
  for (let m = radRe.exec(lower); m; m = radRe.exec(lower)) radii.push(Number(m[1]));
  if (radii.length >= 3) {
    radii.sort((a, b) => a - b);
    const median = radii[Math.floor(radii.length / 2)];
    out.buttonShape = median <= 3 ? "square" : median >= 24 ? "pill" : "rounded";
  }

  return out;
}

/**
 * Brand colours, straight from the vendor's own markup.
 *
 * Must run on the RAW html — the extractor below strips <style> before reading text, which is
 * exactly where most of a page's colours live.
 *
 * Greys, near-white and near-black are dropped: every page is full of #fff/#333/#e5e5e5 for
 * structure, and those tell you nothing about the brand. What's left is ranked by how often it
 * appears, so the colour used for buttons and headings across a long sales page wins over a
 * one-off. Deterministic on purpose — this feeds a real published page, and "traceable to the
 * product's own sales page" (content rule 1) is a stronger guarantee than asking a model to
 * imagine a palette.
 */
export function extractBrandColors(html: string): string[] {
  const counts = new Map<string, number>();

  const add = (r: number, g: number, b: number) => {
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const light = (max + min) / 2 / 255;
    // Saturation in HSL terms; a low value means grey, which is structure, not brand.
    const sat = max === min ? 0 : (max - min) / (light > 0.5 ? 510 - max - min : max + min);
    if (sat < 0.25) return;
    if (light > 0.92 || light < 0.08) return;
    const hex = "#" + [r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("");
    counts.set(hex, (counts.get(hex) ?? 0) + 1);
  };

  // exec loops, not matchAll — this tsconfig's target makes a matchAll iterator a compile error
  // (already learned once in lib/blogSeo.ts).
  const six = /#([0-9a-f]{6})\b/gi;
  for (let m = six.exec(html); m; m = six.exec(html)) {
    const v = m[1];
    add(parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16));
  }
  const three = /#([0-9a-f]{3})\b/gi;
  for (let m = three.exec(html); m; m = three.exec(html)) {
    const v = m[1];
    add(parseInt(v[0] + v[0], 16), parseInt(v[1] + v[1], 16), parseInt(v[2] + v[2], 16));
  }
  const rgb = /rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/gi;
  for (let m = rgb.exec(html); m; m = rgb.exec(html)) {
    const r = Number(m[1]), g = Number(m[2]), b = Number(m[3]);
    if (r <= 255 && g <= 255 && b <= 255) add(r, g, b);
  }

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([hex]) => hex);
}

// Fetch + extract readable text and image candidates from a vendor's sales page. Validated
// live against a real ClickBank vendor page with the same browser-UA approach as the
// marketplace fetch; some pages 302 to a /welcome/-style variant, hence redirect: "follow".
export async function fetchSalesPage(url: string): Promise<SalesPage> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": BROWSER_UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return { ok: false, text: null, imageCandidates: [], brandColors: [], brandStyle: {} };

    const html = await res.text();
    // Both read the RAW html, before cheerio strips <style> below — that's where the colours and
    // the font/radius declarations live.
    const brandColors = extractBrandColors(html);
    const brandStyle = extractBrandStyle(html);
    const $ = cheerio.load(html);
    $("script, style, nav, footer, noscript").remove();
    const text = $("body").text().replace(/\s+/g, " ").trim().slice(0, 12_000);

    const base = new URL(res.url);
    const seen = new Set<string>();
    const candidates: ImageCandidate[] = [];

    const ogImage = $('meta[property="og:image"]').attr("content");
    if (ogImage) {
      try {
        const abs = new URL(ogImage, base).toString();
        seen.add(abs);
        candidates.push({ url: abs, alt: "og:image" });
      } catch {
        // ignore malformed og:image URL
      }
    }

    $("img").each((_, el) => {
      const src = $(el).attr("src") || $(el).attr("data-src");
      if (!src) return;
      try {
        const abs = new URL(src, base).toString();
        if (seen.has(abs)) return;
        seen.add(abs);
        candidates.push({ url: abs, alt: $(el).attr("alt") ?? "" });
      } catch {
        // ignore malformed image src
      }
    });

    return { ok: true, text, imageCandidates: candidates.slice(0, 20), brandColors, brandStyle };
  } catch {
    return { ok: false, text: null, imageCandidates: [], brandColors: [], brandStyle: {} };
  }
}
