/**
 * On-page SEO analysis for a blog post.
 *
 * Isomorphic and pure — the editor scores as you type and the posts list scores what's stored,
 * from the same function, so the number can't mean two things in two places.
 *
 * What this is NOT: a ranking prediction. Nothing here can see a search engine, a competitor, or a
 * query. These are on-page hygiene checks — the things that are objectively true or not true about
 * a document — and the score is a count of them, not an estimate of how the post will perform.
 * Every check names what to do rather than just failing, since a score with no action attached is
 * just a number to feel bad about.
 */

export type SeoCheckStatus = "pass" | "warn" | "fail";

export type SeoCheck = {
  id: string;
  label: string;
  status: SeoCheckStatus;
  /** What's wrong and what to do — shown verbatim, so it has to be actionable on its own. */
  detail: string;
  /** How much this contributes to the score. Not all checks matter equally. */
  weight: number;
};

export type SeoLink = { href: string; internal: boolean };

export type SeoReport = {
  /** 0-100. Weighted pass ratio, with a warn counting half. */
  score: number;
  checks: SeoCheck[];
  wordCount: number;
  internalLinks: number;
  externalLinks: number;
  links: SeoLink[];
  headings: { level: number; text: string }[];
};

export type SeoInput = {
  title: string;
  contentMd: string;
  html?: string | null;
  excerpt?: string | null;
  seoTitle?: string | null;
  seoDescription?: string | null;
  featuredImageUrl?: string | null;
  slug?: string | null;
  /** The blog's own host(s), so a link to your own site counts as internal. */
  siteHosts?: string[];
  /**
   * Which checks apply. A funnel page is served X-Robots-Tag: noindex on purpose, so scoring it
   * on slug shape or internal linking would be scoring it against a job it doesn't have. What
   * still matters there is the share preview (title/description drive og: tags when the link is
   * pasted into a DM or an ad review) and plain readability.
   */
  pageKind?: "post" | "funnel";
};

// Google truncates around these; they're display limits, not ranking factors, which is why
// overshooting is a warn rather than a fail.
export const TITLE_MIN = 30;
export const TITLE_MAX = 60;
export const DESC_MIN = 70;
export const DESC_MAX = 160;
export const MIN_WORDS = 300;

const stripTags = (s: string) => s.replace(/<[^>]*>/g, " ");
const decode = (s: string) =>
  s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

function textOf(input: SeoInput): string {
  // Prefer the rendered HTML: it's what a crawler sees. Markdown is the fallback for a post whose
  // html hasn't been baked yet (drafts written but never saved through the renderer).
  const raw = input.html ? stripTags(input.html) : input.contentMd;
  return decode(raw).replace(/\s+/g, " ").trim();
}

export function countWords(text: string): number {
  return text ? text.split(/\s+/).filter(Boolean).length : 0;
}

/**
 * Links, split into internal and external.
 *
 * "Internal" means the tenant's own blog: a relative href, an anchor within the page, or an
 * absolute URL on one of their own hosts. An affiliate hoplink is external by definition and
 * should be — that's the whole point of the post.
 */
export function extractLinks(input: SeoInput): SeoLink[] {
  const html = input.html ?? "";
  const out: SeoLink[] = [];
  const hosts = (input.siteHosts ?? []).map((h) => h.toLowerCase().replace(/^www\./, ""));

  // Anchors from the rendered HTML...
  const anchor = /<a\b[^>]*\bhref="([^"]*)"/gi;
  for (let m = anchor.exec(html); m; m = anchor.exec(html)) {
    const href = decode(m[1] ?? "").trim();
    if (!href || href.startsWith("#")) continue; // in-page jumps aren't links off the page
    out.push({ href, internal: isInternal(href, hosts) });
  }
  // ...plus markdown links, for a draft with no baked html yet.
  if (!html) {
    const md = input.contentMd ?? "";
    const mdLink = /\[[^\]]*\]\(([^)\s]+)/g;
    for (let m = mdLink.exec(md); m; m = mdLink.exec(md)) {
      const href = (m[1] ?? "").trim();
      if (!href || href.startsWith("#")) continue;
      out.push({ href, internal: isInternal(href, hosts) });
    }
  }
  return out;
}

function isInternal(href: string, hosts: string[]): boolean {
  if (href.startsWith("/")) return true;
  if (/^(mailto|tel):/i.test(href)) return false;
  try {
    const host = new URL(href).hostname.toLowerCase().replace(/^www\./, "");
    return hosts.includes(host);
  } catch {
    // Not an absolute URL and not root-relative — treat as a relative path on this site.
    return !/^[a-z][a-z0-9+.-]*:/i.test(href);
  }
}

export function extractHeadings(input: SeoInput): { level: number; text: string }[] {
  const out: { level: number; text: string }[] = [];
  if (input.html) {
    const h = /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
    for (let m = h.exec(input.html); m; m = h.exec(input.html)) {
      const text = decode(stripTags(m[2] ?? "")).trim();
      if (text) out.push({ level: Number(m[1]), text });
    }
    return out;
  }
  for (const line of (input.contentMd ?? "").split("\n")) {
    const m = line.match(/^(#{1,6})\s+(.*\S)/);
    if (m) out.push({ level: m[1].length, text: m[2].trim() });
  }
  return out;
}

export function analyzePostSeo(input: SeoInput): SeoReport {
  const text = textOf(input);
  const wordCount = countWords(text);
  const links = extractLinks(input);
  const headings = extractHeadings(input);
  const internalLinks = links.filter((l) => l.internal).length;
  const externalLinks = links.length - internalLinks;

  const metaTitle = (input.seoTitle || input.title || "").trim();
  const metaDesc = (input.seoDescription || input.excerpt || "").trim();
  const h2s = headings.filter((h) => h.level === 2).length;

  const isFunnel = input.pageKind === "funnel";
  const checks: SeoCheck[] = [
    {
      id: "title",
      label: "Title length",
      weight: 3,
      ...lengthCheck(metaTitle.length, TITLE_MIN, TITLE_MAX, "title", "Search results cut it off around 60 characters."),
    },
    {
      id: "description",
      label: "Meta description",
      weight: 3,
      ...(metaDesc
        ? lengthCheck(metaDesc.length, DESC_MIN, DESC_MAX, "description", "Results cut it off around 160.")
        : {
            status: "fail" as const,
            detail: "No description or excerpt — search engines will pick a sentence for you, usually the wrong one.",
          }),
    },
    {
      id: "words",
      label: "Length",
      weight: 3,
      ...(wordCount >= MIN_WORDS
        ? { status: "pass" as const, detail: `${wordCount} words.` }
        : wordCount >= MIN_WORDS / 2
          ? { status: "warn" as const, detail: `${wordCount} words — thin for a post meant to rank. Aim for ${MIN_WORDS}+.` }
          : { status: "fail" as const, detail: `${wordCount} words. Too short to say anything a search engine will rank.` }),
    },
    {
      id: "headings",
      label: "Section headings",
      weight: 2,
      ...(h2s >= 2
        ? { status: "pass" as const, detail: `${h2s} sections.` }
        : h2s === 1
          ? { status: "warn" as const, detail: "One section heading. Break the post into scannable parts." }
          : { status: "fail" as const, detail: "No section headings — nothing to scan, and no anchors for a contents list." }),
    },
    {
      id: "internal",
      label: "Internal links",
      weight: input.pageKind === "funnel" ? 0 : 2,
      ...(internalLinks >= 1
        ? { status: "pass" as const, detail: `${internalLinks} link${internalLinks === 1 ? "" : "s"} to your own pages.` }
        : { status: "warn" as const, detail: "No internal links. Link to a related post so readers (and crawlers) have somewhere to go." }),
    },
    {
      id: "external",
      label: "Outbound links",
      weight: 1,
      ...(externalLinks >= 1
        ? { status: "pass" as const, detail: `${externalLinks} outbound link${externalLinks === 1 ? "" : "s"}, including your affiliate links.` }
        : {
            status: "warn" as const,
            detail: isFunnel
              ? "No outbound link — this page has nowhere to send anyone. Check the CTA's destination."
              : "No outbound links — including the offer you're promoting. Is that intentional?",
          }),
    },
    {
      id: "image",
      label: "Featured image",
      weight: 2,
      ...(input.featuredImageUrl
        ? { status: "pass" as const, detail: "Set — used as the hero and the social preview." }
        : { status: "fail" as const, detail: "No featured image. Shared links will have no thumbnail." }),
    },
    {
      id: "slug",
      label: "URL",
      // Weight 0 on a funnel: its URL is /p/{campaignId}/bridge or a mapped domain path, neither
      // of which this page controls, so scoring it would only ever be a permanent deduction for
      // something nobody can fix.
      weight: input.pageKind === "funnel" ? 0 : 1,
      ...slugCheck(input.slug ?? null),
    },
  ];

  // Warn counts half: it's a real deduction, but a post with eight warnings and no failures isn't
  // in the same state as one with eight failures, and a pass/fail-only score would say it was.
  const scored = checks.filter((c) => c.weight > 0);
  const earned = scored.reduce((n, c) => n + c.weight * (c.status === "pass" ? 1 : c.status === "warn" ? 0.5 : 0), 0);
  const total = scored.reduce((n, c) => n + c.weight, 0);
  const score = total > 0 ? Math.round((earned / total) * 100) : 0;

  // Zero-weight checks are dropped entirely rather than shown as a permanent grey row —
  // a check that can't affect the score and can't be acted on is just noise.
  return { score, checks: scored, wordCount, internalLinks, externalLinks, links, headings };
}

function lengthCheck(
  len: number,
  min: number,
  max: number,
  what: string,
  overflowNote: string
): { status: SeoCheckStatus; detail: string } {
  if (len === 0) return { status: "fail", detail: `No ${what} set.` };
  if (len < min) return { status: "warn", detail: `${len} characters — short. ${min}-${max} reads best.` };
  if (len > max) return { status: "warn", detail: `${len} characters. ${overflowNote}` };
  return { status: "pass", detail: `${len} characters.` };
}

function slugCheck(slug: string | null): { status: SeoCheckStatus; detail: string } {
  if (!slug) return { status: "warn", detail: "No slug yet — the URL will fall back to the post id." };
  if (slug.length > 75) return { status: "warn", detail: `${slug.length} characters — long for a URL.` };
  if (slug.split("-").length > 9) return { status: "warn", detail: "Lots of words. A shorter slug is easier to read and share." };
  return { status: "pass", detail: `/${slug}` };
}

/** Traffic-light colour for a score, shared by every surface that shows one. */
export function scoreTone(score: number): "good" | "ok" | "poor" {
  return score >= 80 ? "good" : score >= 50 ? "ok" : "poor";
}
