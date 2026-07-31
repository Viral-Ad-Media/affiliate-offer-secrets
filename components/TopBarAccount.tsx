"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LogOut, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

// Avatar + log out, sitting next to the notifications bell in the top bar. Shared by the desktop
// bar (app/(app)/layout.tsx) and the mobile bar (components/Sidebar.tsx) so signing out isn't
// reachable from one breakpoint but not the other.
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
  const [busy, setBusy] = useState(false);

  const name = [firstName, lastName].filter(Boolean).join(" ").trim();
  const initials =
    ((firstName?.trim()?.[0] ?? "") + (lastName?.trim()?.[0] ?? "")).toUpperCase() ||
    (email.trim()[0] ?? "?").toUpperCase();

  async function logout() {
    setBusy(true);
    await createClient().auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="flex items-center gap-1">
      <Link
        href="/settings/profile"
        title={name ? `${name} · ${email}` : email}
        aria-label="Your profile"
        className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-full border border-ink-600 bg-ink-800 text-[11px] font-semibold text-zinc-400 hover:border-emerald-500"
      >
        {avatarUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element -- data: URL, nothing to optimise */
          <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          initials
        )}
      </Link>
      <button
        onClick={logout}
        disabled={busy}
        title="Log out"
        aria-label="Log out"
        className="rounded-lg p-1.5 text-zinc-400 hover:bg-ink-800 hover:text-red-300 disabled:opacity-50"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
      </button>
    </div>
  );
}
