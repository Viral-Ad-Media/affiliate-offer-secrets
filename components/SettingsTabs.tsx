"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Horizontal tabs across every settings page, rendered by app/(app)/settings/layout.tsx so each
// page keeps its own route (deep-linkable, and the OAuth callbacks / access gate keep their
// URLs). Billing is listed but lives OUTSIDE the (app) route group — the paywall redirects there,
// so nesting it under this layout would infinite-loop exactly the users who need it. Its tab is a
// plain link out; it simply doesn't render this bar when you arrive.
const TABS = [
  { href: "/settings/profile", label: "Profile" },
  { href: "/settings/preferences", label: "Preferences" },
  { href: "/settings/security", label: "Security" },
  { href: "/settings/team", label: "Team" },
  { href: "/settings/integrations", label: "Integrations" },
  { href: "/settings/domains", label: "Domains" },
  { href: "/settings/jobs", label: "Jobs queue" },
  { href: "/settings/billing", label: "Billing" },
];

export default function SettingsTabs() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-wrap gap-1 border-b border-ink-700 pb-px" aria-label="Settings sections">
      {TABS.map((t) => {
        const active = pathname === t.href || pathname.startsWith(`${t.href}/`);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={`rounded-t-lg border-b-2 px-3 py-2 text-sm transition-colors ${
              active
                ? "border-emerald-400 font-medium text-emerald-300"
                : "border-transparent text-zinc-400 hover:text-zinc-100"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
