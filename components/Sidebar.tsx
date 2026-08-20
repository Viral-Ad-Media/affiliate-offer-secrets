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
  Share2,
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
  ChevronLeft,
  ChevronRight,
  User,
  ShieldCheck,
  Link2,
  Globe,
  ListChecks,
  CreditCard,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import ThemeToggle from "@/components/ThemeToggle";
import WorkspaceSwitcher from "@/components/WorkspaceSwitcher";
import NotificationsBell from "@/components/NotificationsBell";
import CreditsChip from "@/components/CreditsChip";
import AppLogo from "@/components/AppLogo";
import TopBarAccount from "@/components/TopBarAccount";

type NavChild = {
  href: string;
  label: string;
  match: (p: string) => boolean;
  /** Only rendered by the drill-down view; the inline submenus stay label-only. */
  icon?: typeof LayoutDashboard;
};
type NavItem = {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  match: (p: string) => boolean;
  children?: NavChild[];
  soon?: boolean;
  /**
   * Render this section as a DRILL-DOWN: clicking it replaces the whole nav with its children
   * plus a Back row, instead of expanding an inline submenu. Fits sections that are a mode you
   * enter (Settings) rather than a group you glance across (Emails, Blog) — seven indented rows
   * under one entry made the main list read as two lists spliced together.
   */
  drill?: boolean;
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
  {
    href: "/ads",
    label: "Ads Manager",
    icon: Target,
    // The parent has to recognise BOTH children's paths or the submenu collapses while you're
    // standing on one of them — the same rule Settings' entry already documents.
    match: (p: string) => p.startsWith("/ads"),
    children: [
      { href: "/ads", label: "Meta", match: (p: string) => p === "/ads" },
      { href: "/ads/tiktok", label: "TikTok", match: (p: string) => p.startsWith("/ads/tiktok") },
    ],
  },
  { href: "/socials", label: "Socials", icon: Share2, match: (p: string) => p.startsWith("/socials") },
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
  { href: "/sms", label: "SMS", icon: MessageSquare, match: (p: string) => p === "/sms" || p.startsWith("/sms/") },
  {
    // /blog redirects to /blog/posts, so the parent lands on the section's list like every other
    // section here.
    href: "/blog/posts",
    sectionHref: "/blog",
    label: "Blog",
    icon: Newspaper,
    match: (p: string) => p.startsWith("/blog"),
    // Shown indented under the parent whenever any /blog route is active (expanded rail + mobile
    // drawer only — the icon-only collapsed rail keeps just the parent icon).
    children: [
      // No "Home" item anymore. The home-layout editor moved to /blog/home, reached from Blog
      // settings — what serves at the blog's root is a SETTING now (0108's static-home choice),
      // and a nav item pointing at one possible answer to that setting read as the answer.
      {
        href: "/blog/posts",
        label: "Posts",
        // Deliberately a negative match, not p === "/blog": the post editor lives at /blog/{id},
        // and Posts should stay highlighted while you're editing one. Listing the siblings is what
        // keeps that from also lighting up on Categories/Settings — so any NEW /blog/* sibling
        // must be added here too, or it will highlight Posts as well as itself.
        match: (p: string) =>
          p.startsWith("/blog") &&
          !["/blog", "/blog/home", "/blog/categories", "/blog/comments", "/blog/settings"].includes(p),
      },
      { href: "/blog/comments", label: "Comments", match: (p: string) => p === "/blog/comments" },
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
    drill: true,
    children: [
      { href: "/settings/profile", label: "Profile", icon: User, match: (p: string) => p === "/settings/profile" },
      { href: "/settings/preferences", label: "Preferences", icon: Settings, match: (p: string) => p === "/settings/preferences" },
      { href: "/settings/security", label: "Security", icon: ShieldCheck, match: (p: string) => p === "/settings/security" },
      { href: "/settings/team", label: "Team", icon: Users, match: (p: string) => p === "/settings/team" },
      { href: "/settings/integrations", label: "Integrations", icon: Link2, match: (p: string) => p === "/settings/integrations" },
      { href: "/settings/domains", label: "Domains", icon: Globe, match: (p: string) => p.startsWith("/settings/domains") },
      { href: "/settings/jobs", label: "Jobs queue", icon: ListChecks, match: (p: string) => p === "/settings/jobs" },
      { href: "/settings/billing", label: "Billing", icon: CreditCard, match: (p: string) => p === "/settings/billing" },
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
  // Which collapsed-rail section is showing its children, and the viewport y to pin it to.
  const [flyout, setFlyout] = useState<{ href: string; top: number } | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  // Drill-down view (Settings): the nav shows that section's children instead of the main list.
  // Seeded from the path so landing on /settings/* from anywhere opens drilled, and re-derived on
  // every route CHANGE — but freely overridable in between, which is what lets Back show the main
  // list while you stand on a settings page without the effect immediately re-drilling.
  const [drilled, setDrilled] = useState(false);

  useEffect(() => {
    setDrilled(pathname.startsWith("/settings"));
  }, [pathname]);

  useEffect(() => {
    setCollapsed(localStorage.getItem("sidebar_collapsed") === "1");
  }, []);

  // Navigating from the drawer should close it — keyed off the route actually changing, so a
  // tap on the current page's own link (no route change) still closes via the link onClick.
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  function toggleCollapsed() {
    // Expanding renders the children inline, so a flyout pinned to the old rail width would
    // otherwise hang there over the page until the next hover.
    setFlyout(null);
    setCollapsed((c) => {
      localStorage.setItem("sidebar_collapsed", c ? "0" : "1");
      return !c;
    });
  }


  const nav = isSuperadmin ? [...NAV, SUPERADMIN_NAV] : NAV;
  const drillSection = nav.find((i) => i.drill);

  // The drilled view: a Back row, the section name, then its children as full-width rows with
  // their own icons — the nav becomes the section's menu instead of growing an indented tail.
  // Only for the EXPANDED sidebar and the mobile drawer; the collapsed rail keeps its hover
  // flyout, where a drill would leave a 64px column showing nothing but a back arrow.
  const drillLinks = (section: NavItem) => (
    <>
      <button
        type="button"
        onClick={() => setDrilled(false)}
        className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-zinc-400 transition-colors hover:bg-ink-800 hover:text-zinc-100"
      >
        <ChevronLeft className="h-4 w-4 shrink-0" />
        <span>Back</span>
      </button>
      <div className="px-2.5 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
        {section.label}
      </div>
      {section.children!.map((c) => {
        const childActive = c.match(pathname);
        const ChildIcon = c.icon ?? Settings;
        return (
          <Link
            key={c.href}
            href={c.href}
            onClick={() => setMobileOpen(false)}
            className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors ${
              childActive ? "bg-emerald-600/15 text-emerald-300" : "text-zinc-400 hover:bg-ink-800 hover:text-zinc-100"
            }`}
          >
            <ChildIcon className="h-4 w-4 shrink-0" />
            <span>{c.label}</span>
          </Link>
        );
      })}
    </>
  );

  const navLinks = (iconOnly: boolean) => {
    if (drilled && !iconOnly && drillSection?.children?.length) {
      return drillLinks(drillSection);
    }
    return nav.map((item) => {
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

      // Collapsed, a section's children have nowhere to render inline — so they get a hover
      // flyout instead of being unreachable without expanding the rail first.
      const hasFlyout = iconOnly && !!children?.length;

      return (
        <div
          key={item.href}
          onMouseEnter={
            hasFlyout
              ? (e) => setFlyout({ href: item.href, top: e.currentTarget.getBoundingClientRect().top })
              : undefined
          }
          onMouseLeave={hasFlyout ? () => setFlyout(null) : undefined}
          onFocus={
            hasFlyout
              ? (e) => setFlyout({ href: item.href, top: e.currentTarget.getBoundingClientRect().top })
              : undefined
          }
          onBlur={hasFlyout ? () => setFlyout(null) : undefined}
        >
          <Link
            href={item.href}
            // Tour anchor. An attribute rather than a class or position, so restyling or
            // reordering the nav can't silently break the tour — only deleting this can.
            data-tour={`nav-${item.href.replace(/^\//, "").split("/")[0]}`}
            title={iconOnly ? item.label : undefined}
            onClick={() => {
              setMobileOpen(false);
              // A drill section opens its own menu as it navigates — and because this is set
              // here, clicking it again while already on a settings page (no route change, so
              // the pathname effect stays quiet) still re-opens the drilled view after Back.
              if (item.drill) setDrilled(true);
            }}
            className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors ${
              iconOnly ? "justify-center" : ""
            } ${active ? "bg-emerald-600/15 text-emerald-300" : "text-zinc-400 hover:bg-ink-800 hover:text-zinc-100"}`}
          >
            <item.icon className="h-4 w-4 shrink-0" />
            {!iconOnly && <span className="flex-1">{item.label}</span>}
            {!iconOnly && item.drill && <ChevronRight className="h-3.5 w-3.5 text-zinc-600" />}
          </Link>

          {/* Fixed, not absolute: the rail is overflow-y-auto, which computes overflow-x to auto
              too, so an absolutely-positioned panel would be clipped. Kept as a DOM child of the
              hover target so moving the pointer into it doesn't fire the wrapper's mouseleave,
              and left-14 + pl-2 bridges the rail's padding so the gap isn't a dead zone. */}
          {hasFlyout && flyout?.href === item.href && (
            <div style={{ top: flyout.top }} className="fixed left-14 z-50 pl-2">
              <div className="min-w-[11rem] rounded-lg border border-ink-700 bg-ink-900 p-1.5 shadow-xl">
                <div className="px-2 pb-1 pt-0.5 text-[11px] uppercase tracking-wide text-zinc-500">
                  {item.label}
                </div>
                {children!.map((c) => {
                  const childActive = c.match(pathname);
                  return (
                    <Link
                      key={c.href}
                      href={c.href}
                      onClick={() => {
                        setFlyout(null);
                        setMobileOpen(false);
                      }}
                      className={`block rounded-md px-2 py-1.5 text-[13px] transition-colors ${
                        childActive
                          ? "bg-emerald-600/15 text-emerald-300"
                          : "text-zinc-400 hover:bg-ink-800 hover:text-zinc-100"
                      }`}
                    >
                      {c.label}
                    </Link>
                  );
                })}
              </div>
            </div>
          )}

          {/* A drill section never expands inline — its children live in the drilled view. */}
          {!iconOnly && active && children && !item.drill && (
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
  };

  // The trial countdown used to sit here; it now lives centered in the top bar alongside the
  // credits chip (components/TrialChip.tsx) — account status, not navigation. The theme toggle
  // moved out too: it's account status, not navigation, so it lives in the top bars now (the
  // desktop one in app/(app)/layout.tsx, the mobile one below) — matching where the marketing nav
  // carries it for signed-out visitors.
  const accountChips = (iconOnly: boolean) => (
    <>
      <WorkspaceSwitcher collapsed={iconOnly} />
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
          <ThemeToggle iconOnly />
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
