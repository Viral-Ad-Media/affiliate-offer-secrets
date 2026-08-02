import type { MetadataRoute } from "next";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://www.affiliateoffersecrets.com";

// Crawl policy: marketing pages and public blog posts (/b/) are indexable; everything auth-gated
// or tenant-specific is disallowed. Funnel pages (/p/, /d/) additionally send X-Robots-Tag:
// noindex from their own routes — disallowing them here too keeps crawlers from even fetching.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/api/",
          "/dashboard",
          "/marketplace",
          "/funnels",
          "/settings/integrations",
          "/settings/domains",
          "/contacts",
          "/emails",
          "/blog",
          "/audit",
          "/settings/billing",
          "/product/",
          "/login",
          "/p/",
          "/d/",
        ],
      },
    ],
    sitemap: `${APP_URL}/sitemap.xml`,
  };
}
