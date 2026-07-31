"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  Megaphone,
  Filter,
  Users,
  Send,
  Newspaper,
  History,
  Gift,
  Award,
  Settings,
  Clock,
  Coins,
  LogOut,
  Menu,
  X,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import ThemeToggle from "@/components/ThemeToggle";
import NotificationsBell from "@/components/NotificationsBell";

const NAV = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard, match: (p: string) => p === "/dashboard" },
  { href: "/marketplace", label: "Marketplace", icon: Megaphone, match: (p: string) => p === "/marketplace" || p.startsWith("/product/") },
  { href: "/funnels", label: "Funnels", icon: Filter, match: (p: string) => p.startsWith("/funnels") },
  { href: "/contacts", label: "Contacts", icon: Users, match: (p: string) => p === "/contacts" },
  {
    href: "/emails/broadcast",
    label: "Emails",
    icon: Send,
    match: (p: string) => p.startsWith("/emails"),
    children: [
      { href: "/emails/broadcast", label: "Broadcast", match: (p: string) => p === "/emails/broadcast" },
      { href: "/emails/sequences", label: "Sequences", match: (p: string) => p.startsWith("/emails/sequences") },
    ],
  },
  {
    href: "/blog",
    label: "Blog",
    icon: Newspaper,
    match: (p: string) => p.startsWith("/blog"),
    // Shown indented under the parent whenever any /blog route is active (expanded rail + mobile
    // drawer only — the icon-only collapsed rail keeps just the parent icon).
    children: [
      { href: "/blog", label: "Posts", match: (p: string) => p.startsWith("/blog") && p !== "/blog/categories" && p !== "/blog/settings" },
      { href: "/blog/categories", label: "Categories", match: (p: string) => p === "/blog/categories" },
      { href: "/blog/settings", label: "Settings", match: (p: string) => p === "/blog/settings" },
    ],
  },
  { href: "/referrals", label: "Referrals", icon: Gift, match: (p: string) => p === "/referrals" },
  { href: "/rewards", label: "Rewards", icon: Award, match: (p: string) => p === "/rewards" },
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
      { href: "/settings/connections", label: "Connections", match: (p: string) => p === "/settings/connections" },
      { href: "/settings/domains", label: "Domains", match: (p: string) => p.startsWith("/settings/domains") },
      { href: "/settings/billing", label: "Billing", match: (p: string) => p === "/settings/billing" },
    ],
  },
];

type Props = {
  email: string;
  onTrial: boolean;
  trialDaysLeft: number;
  creditBalance: number;
  firstName: string | null;
  lastName: string | null;
  avatarUrl: string | null;
};

// Desktop (sm+): a persistent left sidebar, collapsible to an icon-only rail — the choice is
// remembered in localStorage and re-applied after mount (SSR always renders expanded; reading
// localStorage in the initial render would be a hydration mismatch, so the collapsed state
// applies one paint later — a standard, acceptable flash).
// Mobile (<sm): a slim top bar (logo, credits, hamburger) with a slide-in drawer carrying the
// full labeled nav — replaces the old cramped horizontal icon strip.
export default function Sidebar({
  email,
  onTrial,
  trialDaysLeft,
  creditBalance,
  firstName,
  lastName,
  avatarUrl,
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

  async function logout() {
    await createClient().auth.signOut();
    router.push("/login");
    router.refresh();
  }

  const navLinks = (iconOnly: boolean) =>
    NAV.map((item) => {
      const active = item.match(pathname);
      const children = "children" in item ? item.children : undefined;
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
                    className={`block rounded-md px-2 py-1.5 text-[13px] transition-colors ${
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

  const displayName = [firstName, lastName].filter(Boolean).join(" ").trim();
  const initials =
    ((firstName?.trim()?.[0] ?? "") + (lastName?.trim()?.[0] ?? "")).toUpperCase() ||
    (email.trim()[0] ?? "?").toUpperCase();

  const accountChips = (iconOnly: boolean) => (
    <>
      <ThemeToggle iconOnly={iconOnly} />
      {onTrial && (
        <Link
          href="/settings/billing"
          title={iconOnly ? `Trial: ${trialDaysLeft} ${trialDaysLeft === 1 ? "day" : "days"} left` : undefined}
          className={`flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-300 hover:border-amber-500 ${
            iconOnly ? "justify-center" : "justify-center"
          }`}
        >
          <Clock className="h-3.5 w-3.5 shrink-0" />
          {!iconOnly && (
            <span>
              Trial: {trialDaysLeft} {trialDaysLeft === 1 ? "day" : "days"} left
            </span>
          )}
        </Link>
      )}
      <Link
        href="/settings/billing"
        title={iconOnly ? `${creditBalance} credits` : undefined}
        className="flex items-center justify-center gap-1.5 rounded-lg border border-ink-600 px-2.5 py-1.5 text-xs text-emerald-300 hover:border-emerald-500"
      >
        <Coins className="h-3.5 w-3.5 shrink-0" />
        {!iconOnly && <span>{creditBalance} credits</span>}
      </Link>
      {/* Identity chip — links to Profile, which is where you'd go to change any of it. */}
      <Link
        href="/settings/profile"
        title={displayName ? `${displayName} · ${email}` : email}
        className={`flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-ink-800 ${
          iconOnly ? "justify-center" : ""
        }`}
      >
        <span className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full border border-ink-600 bg-ink-800 text-[10px] font-semibold text-zinc-400">
          {avatarUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element -- data: URL, nothing to optimise */
            <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            initials
          )}
        </span>
        {!iconOnly && (
          <span className="min-w-0 flex-1 truncate text-xs text-zinc-500">
            {displayName || email}
          </span>
        )}
      </Link>
      <button
        onClick={logout}
        title={iconOnly ? "Log out" : undefined}
        className="flex items-center justify-center gap-1.5 rounded-lg border border-ink-600 px-2.5 py-1.5 text-xs text-zinc-300 hover:border-red-500 hover:text-red-300"
      >
        <LogOut className="h-3.5 w-3.5 shrink-0" />
        {!iconOnly && <span>Log out</span>}
      </button>
    </>
  );

  return (
    <>
      {/* Desktop sidebar */}
      <aside
        className={`hidden sm:flex sm:h-screen sm:shrink-0 sm:flex-col sm:justify-between sm:overflow-y-auto sm:border-r sm:border-ink-700 sm:bg-ink-900/60 sm:py-6 sm:transition-[width] sm:duration-200 ${
          collapsed ? "sm:w-16 sm:px-2" : "sm:w-60 sm:px-4"
        }`}
      >
        <div className="flex flex-col gap-6">
          <div className={`flex items-center ${collapsed ? "justify-center" : "justify-between px-2"}`}>
            {!collapsed && (
              <Link href="/dashboard" className="font-heading text-base font-bold text-zinc-100">
                Affiliate <span className="text-emerald-400">Studio</span>
              </Link>
            )}
            <div className="flex items-center gap-0.5">
              <NotificationsBell iconOnly={collapsed} />
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
        <Link href="/dashboard" className="font-heading text-base font-bold text-zinc-100">
          Affiliate <span className="text-emerald-400">Studio</span>
        </Link>
        <div className="flex items-center gap-2">
          <NotificationsBell />
          <Link
            href="/settings/billing"
            className="flex items-center gap-1.5 rounded-full border border-ink-600 px-2.5 py-1 text-xs text-emerald-300"
          >
            <Coins className="h-3.5 w-3.5" />
            {creditBalance}
          </Link>
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
                <Link href="/dashboard" onClick={() => setMobileOpen(false)} className="font-heading text-base font-bold text-zinc-100">
                  Affiliate <span className="text-emerald-400">Studio</span>
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
