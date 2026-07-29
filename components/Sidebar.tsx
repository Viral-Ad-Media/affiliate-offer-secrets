"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Megaphone, Filter, Link2, Globe, Users, Send, History, CreditCard, Clock, Coins, LogOut } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

const NAV = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard, match: (p: string) => p === "/dashboard" },
  { href: "/campaigns", label: "Campaigns", icon: Megaphone, match: (p: string) => p === "/campaigns" || p.startsWith("/product/") },
  { href: "/funnels", label: "Funnels", icon: Filter, match: (p: string) => p === "/funnels" },
  { href: "/connections", label: "Connections", icon: Link2, match: (p: string) => p === "/connections" },
  { href: "/domains", label: "Domains", icon: Globe, match: (p: string) => p.startsWith("/domains") },
  { href: "/contacts", label: "Contacts", icon: Users, match: (p: string) => p === "/contacts" },
  { href: "/broadcast", label: "Broadcast", icon: Send, match: (p: string) => p.startsWith("/broadcast") },
  { href: "/audit", label: "Audit trail", icon: History, match: (p: string) => p === "/audit" },
  { href: "/billing", label: "Billing", icon: CreditCard, match: (p: string) => p === "/billing" },
];

export default function Sidebar({
  email,
  onTrial,
  trialDaysLeft,
  creditBalance,
}: {
  email: string;
  onTrial: boolean;
  trialDaysLeft: number;
  creditBalance: number;
}) {
  const pathname = usePathname();
  const router = useRouter();

  async function logout() {
    await createClient().auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <aside className="flex w-full flex-row items-center justify-between gap-2 border-b border-ink-700 bg-ink-900/60 px-4 py-3 sm:h-screen sm:w-60 sm:shrink-0 sm:flex-col sm:items-stretch sm:justify-between sm:overflow-y-auto sm:border-b-0 sm:border-r sm:px-4 sm:py-6">
      <div className="flex items-center gap-6 sm:flex-col sm:items-stretch sm:gap-6">
        <Link href="/dashboard" className="font-heading text-base font-bold text-zinc-100 sm:px-2">
          ClickBank <span className="text-emerald-400">Studio</span>
        </Link>
        <nav className="flex items-center gap-1 sm:flex-col sm:items-stretch sm:gap-0.5">
          {NAV.map((item) => {
            const active = item.match(pathname);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm transition-colors ${
                  active
                    ? "bg-emerald-600/15 text-emerald-300"
                    : "text-zinc-400 hover:bg-ink-800 hover:text-zinc-100"
                }`}
              >
                <item.icon className="h-4 w-4 shrink-0" />
                <span className="hidden sm:inline">{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="flex items-center gap-2 sm:flex-col sm:items-stretch sm:gap-2">
        {onTrial && (
          <Link
            href="/billing"
            className="flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-xs text-amber-300 hover:border-amber-500 sm:justify-center sm:rounded-lg sm:py-1.5"
          >
            <Clock className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">
              Trial: {trialDaysLeft} {trialDaysLeft === 1 ? "day" : "days"} left
            </span>
          </Link>
        )}
        <Link
          href="/billing"
          className="flex items-center gap-1.5 rounded-full border border-ink-600 px-2.5 py-1 text-xs text-emerald-300 hover:border-emerald-500 sm:justify-center sm:rounded-lg sm:py-1.5"
        >
          <Coins className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">{creditBalance} credits</span>
          <span className="sm:hidden">{creditBalance}</span>
        </Link>
        <div className="hidden truncate px-2 text-xs text-zinc-500 sm:block" title={email}>
          {email}
        </div>
        <button
          onClick={logout}
          className="flex items-center gap-1.5 rounded-full border border-ink-600 px-2.5 py-1 text-xs text-zinc-300 hover:border-red-500 hover:text-red-300 sm:justify-center sm:rounded-lg sm:py-1.5"
        >
          <LogOut className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Log out</span>
        </button>
      </div>
    </aside>
  );
}
