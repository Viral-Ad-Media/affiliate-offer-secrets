import type { MetadataRoute } from "next";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://clickbank-studio.vercel.app";

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
          "/connections",
          "/domains",
          "/contacts",
          "/emails",
          "/blog",
          "/audit",
          "/billing",
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
