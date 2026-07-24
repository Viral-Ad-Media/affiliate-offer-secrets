import * as cheerio from "cheerio";
import { BROWSER_UA } from "./clickbank";

export type ImageCandidate = { url: string; alt: string };

export type SalesPage = {
  ok: boolean;
  text: string | null;
  imageCandidates: ImageCandidate[];
};

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
    if (!res.ok) return { ok: false, text: null, imageCandidates: [] };

    const html = await res.text();
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

    return { ok: true, text, imageCandidates: candidates.slice(0, 20) };
  } catch {
    return { ok: false, text: null, imageCandidates: [] };
  }
}
