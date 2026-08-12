import Link from "next/link";
import { Compass } from "lucide-react";
import AppLogo from "@/components/AppLogo";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The app's own 404 — every unmatched path under the marketing site and the signed-in app, plus
 * anything that calls Next's `notFound()`.
 *
 * Deliberately NOT the one public funnel/blog pages serve. Those go through
 * lib/notFoundPage.ts, which must stay unbranded on a tenant's own domain and must never hint at
 * WHY a URL failed (an unguessable campaign id is the access control there, so a distinguishable
 * 404 would enumerate). This page has neither constraint: it only ever renders on our own host,
 * for someone who typed or followed a bad link, so it can say something useful and offer a way on.
 *
 * Self-contained by necessity. Next renders the root not-found inside app/layout.tsx only — which
 * is fonts and <body> and nothing else — so no sidebar, no marketing nav, and no container comes
 * with it. Hence the explicit centring and the wordmark.
 *
 * It carries links to BOTH the marketing home and the dashboard because it has no idea which side
 * of the paywall the reader is on: a signed-out visitor following a stale link and an operator
 * fat-fingering a URL land in exactly the same place. The dashboard link costs a signed-out
 * visitor one redirect to /login, which is a better outcome than not offering it.
 */
export const metadata = {
  title: "Page not found",
  // A 404 has nothing worth indexing, and letting one into the index competes with the real pages.
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 py-16 text-center">
      <Link href="/" className="mb-10" aria-label="Affiliate Offer Secrets home">
        <AppLogo />
      </Link>

      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-400">
        <Compass className="h-6 w-6" />
      </div>

      <p className="mt-6 text-xs font-semibold uppercase tracking-[0.12em] text-zinc-500">404</p>
      <h1 className="mt-2 font-heading text-3xl font-bold text-zinc-100 sm:text-4xl">
        We can&apos;t find that page
      </h1>
      <p className="mt-3 max-w-md text-sm leading-relaxed text-zinc-400">
        The link may be wrong or out of date, or the page may have moved. Nothing is broken on your
        side.
      </p>

      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Link href="/" className={cn(buttonVariants(), "px-5 py-2.5 text-sm")}>
          Back to home
        </Link>
        <Link
          href="/dashboard"
          className={cn(buttonVariants({ variant: "outline" }), "px-5 py-2.5 text-sm")}
        >
          Go to dashboard
        </Link>
      </div>

      <p className="mt-10 text-xs text-zinc-600">
        Think this should exist?{" "}
        <Link href="/contact" className="text-zinc-400 underline hover:text-emerald-300">
          Let us know
        </Link>
        .
      </p>
    </main>
  );
}
