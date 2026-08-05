"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import {
  ChevronDown,
  CreditCard,
  LayoutDashboard,
  Link2,
  Loader2,
  LogOut,
  ShieldCheck,
  User,
  Users,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";

// Dashboard sits at the top, separated from the account items below it, because it's the only
// entry here that isn't about your account — it's the way back INTO the app. That matters most on
// the marketing site: MarketingNav renders this same menu for a signed-in visitor, and until now
// someone who landed on the homepage or a legal page had no route back to their dashboard except
// editing the URL. Inside the app it's redundant with the sidebar, and harmlessly so.
const MENU: { href: string; label: string; icon: typeof User }[] = [
  { href: "/settings/profile", label: "Profile", icon: User },
  { href: "/settings/security", label: "Security", icon: ShieldCheck },
  { href: "/settings/team", label: "Team", icon: Users },
  { href: "/settings/integrations", label: "Integrations", icon: Link2 },
  { href: "/settings/billing", label: "Plan & credits", icon: CreditCard },
];

// Avatar + first name + dropdown, sitting next to the notifications bell. Shared by the desktop
// bar (app/(app)/layout.tsx) and the mobile bar (components/Sidebar.tsx) so account actions aren't
// reachable at one breakpoint but not the other.
export default function TopBarAccount({
  email,
  firstName,
  lastName,
  avatarUrl,
}: {
  email: string;
  firstName: string | null;
  lastName: string | null;
  avatarUrl: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // Portalled + anchored to the button's measured rect: the mobile instance lives inside a header
  // that clips, and an absolutely-positioned menu gets cut off there. Same fix as the bell.
  const [anchor, setAnchor] = useState<{ top: number; right: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const fullName = [firstName, lastName].filter(Boolean).join(" ").trim();
  const initials =
    ((firstName?.trim()?.[0] ?? "") + (lastName?.trim()?.[0] ?? "")).toUpperCase() ||
    (email.trim()[0] ?? "?").toUpperCase();

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function logout() {
    setBusy(true);
    await createClient().auth.signOut();
    router.push("/login");
    router.refresh();
  }

  function toggle() {
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setAnchor({ top: r.bottom + 8, right: Math.max(8, window.innerWidth - r.right) });
    setOpen((o) => !o);
  }

  return (
    <>
      <button
        ref={btnRef}
        onClick={toggle}
        aria-haspopup="menu"
        aria-expanded={open}
        title={fullName ? `${fullName} · ${email}` : email}
        className="flex items-center gap-1.5 rounded-lg py-1 pl-1 pr-1.5 text-sm text-zinc-300 hover:bg-ink-800"
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full border border-ink-600 bg-ink-800 text-[12px] font-semibold text-zinc-400">
          {avatarUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element -- data: URL, nothing to optimise */
            <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            initials
          )}
        </span>
        {/* First name only — the full name and email live in the menu header, and a long surname
            would push the bar around. Hidden below sm, where the mobile bar is tight and the
            avatar alone is enough. */}
        <span className="hidden max-w-[10rem] truncate sm:inline">
          {firstName || email.split("@")[0]}
        </span>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-zinc-500 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open &&
        anchor &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            style={{ top: anchor.top, right: anchor.right }}
            className="fixed z-50 w-60 overflow-hidden rounded-xl border border-ink-600 bg-ink-900 shadow-xl"
          >
            <div className="border-b border-ink-700 px-3 py-2.5">
              <div className="truncate text-sm text-zinc-100">{fullName || "Your account"}</div>
              <div className="truncate text-xs text-zinc-500" title={email}>
                {email}
              </div>
            </div>

            <div className="border-b border-ink-700 py-1">
              <Link
                href="/dashboard"
                role="menuitem"
                onClick={() => setOpen(false)}
                className="flex items-center gap-2.5 px-3 py-2 text-sm text-zinc-100 hover:bg-ink-800"
              >
                <LayoutDashboard className="h-4 w-4 shrink-0 text-emerald-400" />
                Dashboard
              </Link>
            </div>

            <div className="py-1">
              {MENU.map((m) => (
                <Link
                  key={m.href}
                  href={m.href}
                  role="menuitem"
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-2.5 px-3 py-2 text-sm text-zinc-300 hover:bg-ink-800 hover:text-zinc-100"
                >
                  <m.icon className="h-4 w-4 shrink-0 text-zinc-500" />
                  {m.label}
                </Link>
              ))}
            </div>

            <div className="border-t border-ink-700 py-1">
              <button
                role="menuitem"
                onClick={logout}
                disabled={busy}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-zinc-300 hover:bg-ink-800 hover:text-red-300 disabled:opacity-50"
              >
                {busy ? (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                ) : (
                  <LogOut className="h-4 w-4 shrink-0 text-zinc-500" />
                )}
                Log out
              </button>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
