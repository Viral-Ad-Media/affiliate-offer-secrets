import * as cheerio from "cheerio";
import { BROWSER_UA } from "./clickbank";

export type ImageCandidate = { url: string; alt: string };

export type SalesPage = {
  ok: boolean;
  text: string | null;
  imageCandidates: ImageCandidate[];
  /** Hex colours found in the page's own styles, most-used first. See extractBrandColors. */
  brandColors: string[];
};

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
    if (!res.ok) return { ok: false, text: null, imageCandidates: [], brandColors: [] };

    const html = await res.text();
    // Before cheerio strips <style> below — that's where the colours are.
    const brandColors = extractBrandColors(html);
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

    return { ok: true, text, imageCandidates: candidates.slice(0, 20), brandColors };
  } catch {
    return { ok: false, text: null, imageCandidates: [], brandColors: [] };
  }
}
