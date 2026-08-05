"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight, Home } from "lucide-react";
import { NAV_LABELS, NAV_SECTION_LABELS } from "@/components/Sidebar";

// Labels for path segments the sidebar has no entry for. Two kinds live here:
//   * grouping segments that aren't pages at all (`/emails` — the nav points at
//     /emails/broadcast — and `/product`, which only ever exists as /product/{id});
//   * segments the sidebar covers under a different href (`product` belongs to Marketplace).
const SEGMENT_LABELS: Record<string, string> = {
  emails: "Emails",
  sequences: "Sequences",
  product: "Marketplace",
  admin: "Superadmin",
  invite: "Invitation",
};

// Where a segment should link when it isn't itself a page. `/product` has no route; the thing a
// person means by it is the Marketplace list they came from.
const SEGMENT_HREFS: Record<string, string> = {
  product: "/marketplace",
  emails: "/emails/broadcast",
  sequences: "/emails/sequences",
  // /settings is a real route, but it only redirects to /settings/profile — link straight there
  // rather than sending someone through a redirect.
  settings: "/settings/profile",
};

// What a dynamic child of each section IS, so a UUID never reaches the screen. "Funnels / Funnel"
// tells you where you are; "Funnels / 8c3f…" tells you nothing.
const DYNAMIC_LABELS: Record<string, string> = {
  product: "Product",
  funnels: "Funnel",
  blog: "Post",
  sequences: "Sequence",
  domains: "Domain",
  invite: "Invitation",
};

// Anything that isn't a readable slug — UUIDs, and the opaque ids used for posts, launches and
// sequences. Deliberately loose rather than a strict UUID regex: the point is "this is an id, not
// a word", and a long hex-ish token is an id whatever its exact shape.
function looksLikeId(segment: string): boolean {
  return (
    /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(segment) ||
    (/^[0-9a-z]{12,}$/i.test(segment) && /\d/.test(segment))
  );
}

function titleCase(segment: string): string {
  return segment.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Where-am-I trail for nested app pages.
 *
 * Renders NOTHING on top-level pages: at depth 1 the sidebar's own active highlight already says
 * "Marketplace", and a one-item breadcrumb is pure chrome. It earns its space only once a page is
 * somewhere the sidebar can't fully locate — a product inside Marketplace, a step inside a funnel,
 * a sub-page of Settings.
 */
export default function Breadcrumbs() {
  const pathname = usePathname() || "/";
  const segments = pathname.split("/").filter(Boolean);

  if (segments.length < 2) return null;

  const crumbs = segments.map((segment, i) => {
    const href = "/" + segments.slice(0, i + 1).join("/");
    const parent = i > 0 ? segments[i - 1] : "";
    const isLast = i === segments.length - 1;

    // A non-final segment is a SECTION, so the section name wins ("Blog / Categories"). The final
    // segment is the page you're on, so its own specific label wins ("Contacts / Tags").
    const named = isLast
      ? (NAV_LABELS[href] ?? NAV_SECTION_LABELS[href])
      : (NAV_SECTION_LABELS[href] ?? NAV_LABELS[href]);

    const label = looksLikeId(segment)
      ? (DYNAMIC_LABELS[parent] ?? "Detail")
      : (named ?? SEGMENT_LABELS[segment] ?? titleCase(segment));

    // A crumb links only when there is somewhere real to go: a nav destination, or an explicit
    // mapping for a grouping segment. An id crumb never links — it IS the page you're on.
    const linkTo = looksLikeId(segment) ? null : (NAV_LABELS[href] ? href : SEGMENT_HREFS[segment] ?? null);

    return { label, href: linkTo };
  });

  return (
    <nav aria-label="Breadcrumb" className="mb-4 flex items-center gap-1 text-xs text-zinc-500">
      <Link href="/dashboard" className="flex items-center hover:text-zinc-300" aria-label="Overview">
        <Home className="h-3.5 w-3.5" />
      </Link>
      {crumbs.map((crumb, i) => {
        const isLast = i === crumbs.length - 1;
        return (
          <span key={i} className="flex items-center gap-1">
            <ChevronRight className="h-3 w-3 text-zinc-700" />
            {crumb.href && !isLast ? (
              <Link href={crumb.href} className="hover:text-zinc-300">
                {crumb.label}
              </Link>
            ) : (
              // The current page is never a link to itself.
              <span className={isLast ? "text-zinc-300" : undefined} aria-current={isLast ? "page" : undefined}>
                {crumb.label}
              </span>
            )}
          </span>
        );
      })}
    </nav>
  );
}
