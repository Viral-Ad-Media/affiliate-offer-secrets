import Link from "next/link";
import { ShieldAlert, ArrowLeft } from "lucide-react";
import { requireSuperadminOr404 } from "@/lib/admin";

export const dynamic = "force-dynamic";

// Deliberately OUTSIDE the (app) route group. That group's layout is the paywall — it redirects
// to /billing when hasAppAccess() is false — and an operator whose own trial has lapsed must not
// lose the ability to see why the platform is on fire. The auth requirement still applies:
// middleware bounces anyone with no session to /login before this renders.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Gate every page under /admin in one place. Non-superadmins get a 404, not a 403 — the surface
  // doesn't confirm it exists to someone who can't use it.
  await requireSuperadminOr404();

  return (
    <div className="min-h-screen bg-ink-950">
      <div className="border-b border-amber-500/30 bg-amber-500/10">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-2">
          <div className="flex items-center gap-2 text-sm text-amber-200">
            <ShieldAlert className="h-4 w-4 shrink-0" />
            <span>
              Superadmin — you are looking at <strong>every tenant&apos;s</strong> data. Actions here
              are recorded.
            </span>
          </div>
          <Link
            href="/dashboard"
            className="flex shrink-0 items-center gap-1 text-xs text-amber-200/80 hover:text-amber-100"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back to app
          </Link>
        </div>
      </div>
      <div className="mx-auto max-w-7xl px-4 py-6">{children}</div>
    </div>
  );
}
