import type { MetadataRoute } from "next";
import { APP_URL } from "@/lib/appUrl";

// Static marketing routes only. Tenant blog posts (/b/{postId}) are deliberately not enumerated —
// a global sitemap of every tenant's posts would be a cross-tenant enumeration surface; each post
// is still crawlable via links the tenant shares.
export default function sitemap(): MetadataRoute.Sitemap {
  const routes = ["", "/about", "/pricing", "/faq", "/contact", "/terms", "/privacy"];
  return routes.map((path) => ({
    url: `${APP_URL}${path}`,
    changeFrequency: path === "" ? "weekly" : "monthly",
    priority: path === "" ? 1 : path === "/pricing" ? 0.8 : 0.5,
  }));
}
