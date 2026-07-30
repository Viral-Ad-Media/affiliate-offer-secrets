export const MAX_SEO_TITLE = 70;
export const MAX_SEO_DESCRIPTION = 200;

// Shared normalizer for the per-item SEO override fields (0032_seo_meta.sql) — used by every
// route that accepts them (blog posts, campaigns/opt-in, funnel steps). Empty/whitespace becomes
// null so "cleared" and "never set" are the same state, and both fall back to derived defaults.
export function cleanSeoField(v: unknown, max: number): string | null {
  return typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
}

export function seoPatchFrom(body: Record<string, unknown>): {
  seo_title: string | null;
  seo_description: string | null;
} {
  return {
    seo_title: cleanSeoField(body.seo_title, MAX_SEO_TITLE),
    seo_description: cleanSeoField(body.seo_description, MAX_SEO_DESCRIPTION),
  };
}
