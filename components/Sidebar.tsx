"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  Megaphone,
  Package,
  Filter,
  Target,
  Users,
  BarChart3,
  Send,
  Newspaper,
  MessageSquare,
  History,
  Gift,
  Settings,
  LogOut,
  Menu,
  X,
  PanelLeftClose,
  PanelLeftOpen,
  ShieldAlert,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import ThemeToggle from "@/components/ThemeToggle";
import WorkspaceSwitcher from "@/components/WorkspaceSwitcher";
import NotificationsBell from "@/components/NotificationsBell";
import CreditsChip from "@/components/CreditsChip";
import AppLogo from "@/components/AppLogo";
import TopBarAccount from "@/components/TopBarAccount";

type NavChild = { href: string; label: string; match: (p: string) => boolean };
type NavItem = {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  match: (p: string) => boolean;
  children?: NavChild[];
  soon?: boolean;
  /**
   * The section's own URL prefix, when `href` points at a child instead of it.
   *
   * Blog's parent link goes to /blog (its Home child) but the SECTION is still /blog, and
   * breadcrumbs need that to render "Blog / Categories" rather than "Posts / Categories" — /blog
   * is also the Posts child's href, so the flattened label map resolves it to "Posts".
   */
  sectionHref?: string;
};

const NAV: NavItem[] = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard, match: (p: string) => p === "/dashboard" },
  { href: "/marketplace", label: "Marketplace", icon: Megaphone, match: (p: string) => p === "/marketplace" },
  // Product detail pages hang off this entry, not Marketplace — you reach a kit from the list of
  // offers you already track, not from discovery.
  { href: "/products", label: "My Products", icon: Package, match: (p: string) => p === "/products" || p.startsWith("/product/") },
  { href: "/funnels", label: "Funnels", icon: Filter, match: (p: string) => p.startsWith("/funnels") },
  // Read-only view over every ad_launches row. Launching/activating stays on the angle's own card
  // on the campaign page — see the comment at the top of app/(app)/ads/page.tsx.
  { href: "/ads", label: "Ads Manager", icon: Target, match: (p: string) => p.startsWith("/ads") },
  {
    href: "/contacts",
    label: "Contacts",
    icon: Users,
    match: (p: string) => p.startsWith("/contacts"),
    children: [
      { href: "/contacts", label: "Leads", match: (p: string) => p === "/contacts" },
      { href: "/contacts/tags", label: "Tags", match: (p: string) => p === "/contacts/tags" },
      { href: "/contacts/import", label: "Import", match: (p: string) => p === "/contacts/import" },
      { href: "/contacts/export", label: "Export", match: (p: string) => p === "/contacts/export" },
    ],
  },
  {
    href: "/emails/broadcast",
    label: "Emails",
    icon: Send,
    match: (p: string) => p.startsWith("/emails"),
    children: [
      { href: "/emails/broadcast", label: "Broadcast", match: (p: string) => p === "/emails/broadcast" },
      { href: "/emails/sequences", label: "Sequences", match: (p: string) => p.startsWith("/emails/sequences") },
      { href: "/emails/settings", label: "Settings", match: (p: string) => p === "/emails/settings" },
    ],
  },
  { href: "/sms", label: "SMS", icon: MessageSquare, match: () => false, soon: true },
  {
    // The section's own first child, not /blog — /blog IS the Posts page, so clicking the parent
    // used to land on the second item in its own submenu. Every other section here points at the
    // top of its list; this one was the exception because its list grew a Home above the original
    // page rather than beside it.
    href: "/blog",
    sectionHref: "/blog",
    label: "Blog",
    icon: Newspaper,
    match: (p: string) => p.startsWith("/blog"),
    // Shown indented under the parent whenever any /blog route is active (expanded rail + mobile
    // drawer only — the icon-only collapsed rail keeps just the parent icon).
    children: [
      { href: "/blog", label: "Home", match: (p: string) => p === "/blog" },
      {
        href: "/blog/posts",
        label: "Posts",
        // Deliberately a negative match, not p === "/blog": the post editor lives at /blog/{id},
        // and Posts should stay highlighted while you're editing one. Listing the siblings is what
        // keeps that from also lighting up on Home/Categories/Settings — so any NEW /blog/*
        // sibling must be added here too, or it will highlight Posts as well as itself.
        match: (p: string) =>
          p.startsWith("/blog") && !["/blog", "/blog/categories", "/blog/settings"].includes(p),
      },
      { href: "/blog/categories", label: "Categories", match: (p: string) => p === "/blog/categories" },
      { href: "/blog/settings", label: "Settings", match: (p: string) => p === "/blog/settings" },
    ],
  },
  // Two sides of the same programme — you refer people, you earn rewards for it — so they share
  // one nav section instead of two adjacent top-level entries.
  {
    href: "/referrals",
    label: "Referrals",
    icon: Gift,
    match: (p: string) => p === "/referrals" || p === "/rewards",
    children: [
      { href: "/referrals", label: "Invite & track", match: (p: string) => p === "/referrals" },
      { href: "/rewards", label: "Rewards", match: (p: string) => p === "/rewards" },
    ],
  },
  { href: "/analytics", label: "Analytics", icon: BarChart3, match: (p: string) => p === "/analytics" },
  { href: "/audit", label: "Audit trail", icon: History, match: (p: string) => p === "/audit" },
  // Billing lives OUTSIDE the (app) route group (app/settings/billing) even though its URL nests
  // under /settings — (app)/layout.tsx redirects to it when access is missing, so nesting it
  // inside that layout would infinite-loop for exactly the users who need to reach it.
  {
    href: "/settings/profile",
    label: "Settings",
    icon: Settings,
    match: (p: string) => p.startsWith("/settings"),
    children: [
      { href: "/settings/profile", label: "Profile", match: (p: string) => p === "/settings/profile" },
      { href: "/settings/security", label: "Security", match: (p: string) => p === "/settings/security" },
      { href: "/settings/team", label: "Team", match: (p: string) => p === "/settings/team" },
      { href: "/settings/integrations", label: "Integrations", match: (p: string) => p === "/settings/integrations" },
      { href: "/settings/domains", label: "Domains", match: (p: string) => p.startsWith("/settings/domains") },
      { href: "/settings/jobs", label: "Jobs queue", match: (p: string) => p === "/settings/jobs" },
      { href: "/settings/billing", label: "Billing", match: (p: string) => p === "/settings/billing" },
    ],
  },
];

const SUPERADMIN_NAV: NavItem = {
  href: "/admin",
  label: "Superadmin",
  icon: ShieldAlert,
  match: (p: string) => p.startsWith("/admin"),
};

// Flattened href -> label, derived from NAV rather than hand-written, so components/Breadcrumbs.tsx
// can never disagree with the sidebar about what a section is called. Adding a nav entry updates
// the breadcrumbs for free; renaming one renames both.
export const NAV_LABELS: Record<string, string> = (() => {
  const out: Record<string, string> = {};
  for (const item of [...NAV, SUPERADMIN_NAV]) {
    out[item.href] = item.label;
    for (const child of item.children ?? []) out[child.href] = child.label;
  }
  return out;
})();

// Section names only. Needed as a SEPARATE map because several sections point at one of their own
// children — /blog's nav href is "/blog" and so is its "Posts" child, /contacts' is "/contacts" and
// so is its "Leads" child — so in the flattened map above the child label wins and the section name
// is lost. A breadcrumb wants "Blog / Categories", not "Posts / Categories", so it reads this first
// for any non-final segment and NAV_LABELS for the page it actually landed on.
export const NAV_SECTION_LABELS: Record<string, string> = (() => {
  const out: Record<string, string> = {};
  for (const item of [...NAV, SUPERADMIN_NAV]) out[item.sectionHref ?? item.href] = item.label;
  return out;
})();

type Props = {
  email: string;
  creditBalance: number;
  firstName: string | null;
  lastName: string | null;
  avatarUrl: string | null;
  isSuperadmin?: boolean;
};

// Desktop (sm+): a persistent left sidebar, collapsible to an icon-only rail — the choice is
// remembered in localStorage and re-applied after mount (SSR always renders expanded; reading
// localStorage in the initial render would be a hydration mismatch, so the collapsed state
// applies one paint later — a standard, acceptable flash).
// Mobile (<sm): a slim top bar (logo, credits, hamburger) with a slide-in drawer carrying the
// full labeled nav — replaces the old cramped horizontal icon strip.
export default function Sidebar({
  email,
  creditBalance,
  firstName,
  lastName,
  avatarUrl,
  isSuperadmin = false,
}: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    setCollapsed(localStorage.getItem("sidebar_collapsed") === "1");
  }, []);

  // Navigating from the drawer should close it — keyed off the route actually changing, so a
  // tap on the current page's own link (no route change) still closes via the link onClick.
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  function toggleCollapsed() {
    setCollapsed((c) => {
      localStorage.setItem("sidebar_collapsed", c ? "0" : "1");
      return !c;
    });
  }


  const nav = isSuperadmin ? [...NAV, SUPERADMIN_NAV] : NAV;

  const navLinks = (iconOnly: boolean) =>
    nav.map((item) => {
      const active = item.match(pathname);
      const children = item.children;
      const soon = item.soon === true;

      // Rendered as a non-link: a nav item that navigates to a 404 is worse than one that's
      // visibly inert. Keeps the icon and label so the roadmap is legible.
      if (soon) {
        return (
          <div
            key={item.href}
            title={`${item.label} — coming soon`}
            className={`flex cursor-default items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-zinc-600 ${
              iconOnly ? "justify-center" : ""
            }`}
          >
            <item.icon className="h-4 w-4 shrink-0" />
            {!iconOnly && (
              <>
                <span className="flex-1">{item.label}</span>
                <span className="rounded border border-ink-700 px-1.5 py-0.5 text-[11px] uppercase tracking-wide text-zinc-600">
                  Soon
                </span>
              </>
            )}
          </div>
        );
      }

      return (
        <div key={item.href}>
          <Link
            href={item.href}
            title={iconOnly ? item.label : undefined}
            onClick={() => setMobileOpen(false)}
            className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors ${
              iconOnly ? "justify-center" : ""
            } ${active ? "bg-emerald-600/15 text-emerald-300" : "text-zinc-400 hover:bg-ink-800 hover:text-zinc-100"}`}
          >
            <item.icon className="h-4 w-4 shrink-0" />
            {!iconOnly && <span>{item.label}</span>}
          </Link>
          {!iconOnly && active && children && (
            <div className="ml-4 mt-0.5 space-y-0.5 border-l border-ink-700 pl-3">
              {children.map((c) => {
                const childActive = c.match(pathname);
                return (
                  <Link
                    key={c.href}
                    href={c.href}
                    onClick={() => setMobileOpen(false)}
                    className={`block rounded-md px-2 py-1.5 text-[14px] transition-colors ${
                      childActive ? "text-emerald-300" : "text-zinc-500 hover:text-zinc-200"
                    }`}
                  >
                    {c.label}
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      );
    });


  // The trial countdown used to sit here; it now lives centered in the top bar alongside the
  // credits chip (components/TrialChip.tsx) — account status, not navigation.
  const accountChips = (iconOnly: boolean) => (
    <>
      <WorkspaceSwitcher collapsed={iconOnly} />
      <ThemeToggle iconOnly={iconOnly} />
    </>
  );

  return (
    <>
      {/* Desktop sidebar. sticky + h-screen + self-start: the page itself is what scrolls, so
          without this the nav scrolls away on any long page. self-start stops the flex row from
          stretching the aside to the full page height, which would defeat the sticky. */}
      <aside
        className={`hidden sm:sticky sm:top-0 sm:flex sm:h-screen sm:shrink-0 sm:flex-col sm:justify-between sm:self-start sm:overflow-y-auto sm:border-r sm:border-ink-700 sm:bg-ink-900/60 sm:py-6 sm:transition-[width] sm:duration-200 ${
          collapsed ? "sm:w-16 sm:px-2" : "sm:w-60 sm:px-4"
        }`}
      >
        <div className="flex flex-col gap-6">
          <div className={`flex items-center ${collapsed ? "justify-center" : "justify-between px-2"}`}>
            {collapsed ? (
              // Collapsed rail: the mark alone still identifies the app and keeps a "go home"
              // target where the wordmark link would be.
              <Link href="/dashboard" title="Affiliate Offer Secrets">
                <AppLogo wordmark={false} />
              </Link>
            ) : (
              <Link href="/dashboard">
                <AppLogo wordmark="short" />
              </Link>
            )}
            <div className="flex items-center gap-0.5">
              <button
                onClick={toggleCollapsed}
                title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                className="rounded-lg p-1.5 text-zinc-500 hover:bg-ink-800 hover:text-zinc-200"
              >
                {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <nav className="flex flex-col gap-0.5">{navLinks(collapsed)}</nav>
        </div>
        <div className="flex flex-col gap-2">{accountChips(collapsed)}</div>
      </aside>

      {/* Mobile top bar */}
      <header className="flex items-center justify-between border-b border-ink-700 bg-ink-900/60 px-4 py-3 sm:hidden">
        <Link href="/dashboard">
          <AppLogo wordmark="short" />
        </Link>
        <div className="flex items-center gap-2">
          <CreditsChip creditBalance={creditBalance} />
          <NotificationsBell />
          <TopBarAccount
            email={email}
            firstName={firstName}
            lastName={lastName}
            avatarUrl={avatarUrl}
          />
          <button
            onClick={() => setMobileOpen(true)}
            title="Open menu"
            className="rounded-lg p-1.5 text-zinc-300 hover:bg-ink-800"
          >
            <Menu className="h-5 w-5" />
          </button>
        </div>
      </header>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 sm:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setMobileOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col justify-between overflow-y-auto border-r border-ink-700 bg-ink-900 px-4 py-6">
            <div className="flex flex-col gap-6">
              <div className="flex items-center justify-between px-2">
                <Link href="/dashboard" onClick={() => setMobileOpen(false)}>
                  <AppLogo wordmark="short" />
                </Link>
                <button
                  onClick={() => setMobileOpen(false)}
                  title="Close menu"
                  className="rounded-lg p-1.5 text-zinc-400 hover:bg-ink-800 hover:text-zinc-200"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <nav className="flex flex-col gap-0.5">{navLinks(false)}</nav>
            </div>
            <div className="flex flex-col gap-2 pt-6">{accountChips(false)}</div>
          </div>
        </div>
      )}
    </>
  );
}
