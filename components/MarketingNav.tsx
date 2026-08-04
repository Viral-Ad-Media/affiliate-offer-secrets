"use client";

import { useState } from "react";
import Link from "next/link";
import AppLogo from "@/components/AppLogo";
import { Menu, X } from "lucide-react";
import AuthModal from "@/components/AuthModal";

const LINKS = [
  { href: "/about", label: "About" },
  { href: "/pricing", label: "Pricing" },
  { href: "/faq", label: "FAQ" },
  { href: "/contact", label: "Contact" },
];

// Marketing-site header. Desktop (md+): inline links + auth buttons. Mobile: hamburger toggling a
// dropdown panel — previously the three flex groups wrapped into a messy multi-row header on
// narrow screens.
export default function MarketingNav() {
  const [open, setOpen] = useState(false);

  return (
    <header className="border-b border-ink-700 bg-ink-950/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-4">
        <Link href="/" onClick={() => setOpen(false)}>
          <AppLogo markClassName="h-8 w-8" textClassName="font-heading text-lg font-bold text-zinc-100" />
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="rounded-full px-3 py-1.5 text-sm text-zinc-400 hover:bg-ink-800 hover:text-zinc-100"
            >
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-2 md:flex">
          <AuthModal mode="login" className="btn-ghost">
            Sign in
          </AuthModal>
          <AuthModal mode="signup" className="btn-primary">
            Get started
          </AuthModal>
        </div>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="rounded-lg p-2 text-zinc-300 hover:bg-ink-800 md:hidden"
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {open && (
        <div className="border-t border-ink-800 px-4 pb-4 pt-2 md:hidden">
          <nav className="flex flex-col">
            {LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className="rounded-lg px-3 py-2.5 text-sm text-zinc-300 hover:bg-ink-800 hover:text-zinc-100"
              >
                {l.label}
              </Link>
            ))}
          </nav>
          <div className="mt-3 flex items-center gap-2">
            <AuthModal mode="login" className="btn-ghost flex-1 justify-center">
              Sign in
            </AuthModal>
            <AuthModal mode="signup" className="btn-primary flex-1 justify-center">
              Get started
            </AuthModal>
          </div>
        </div>
      )}
    </header>
  );
}
