import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { AUTH_COOKIE_OPTIONS } from "@/lib/supabase/cookieOptions";

// Exact-match only — "/" as a prefix would match every path and disable the auth gate entirely.
const PUBLIC_EXACT_PATHS = [
  "/",
  "/login",
  "/about",
  "/pricing",
  "/faq",
  "/contact",
  "/terms",
  "/privacy",
];

// Icon files App Router generates as top-level routes. Browsers fetch these before (and without)
// any session, so they must never hit the auth gate.
const ICON_PATHS = ["/icon.svg", "/apple-icon.png", "/favicon.ico"];

// Same class of bug as ICON_PATHS: App Router serves app/robots.ts and app/sitemap.ts as real
// top-level routes, so the auth gate 307'd both to /login. Every crawler that asked this app for
// its robots.txt or sitemap got a redirect to a login page instead — which is exactly the traffic
// those two files exist to serve. Caught the day the real domain went live.
const CRAWLER_PATHS = ["/robots.txt", "/sitemap.xml"];

// Prefix-match — dynamic sub-paths (e.g. /p/[campaignId]/bridge) or server-to-server webhooks.
const PUBLIC_PREFIX_PATHS = [
  "/api/billing/webhook",
  "/api/engine/run",
  "/api/meta/deauthorize",
  "/p/", // public bridge (lead-capture landing) pages — real ad destinations, no auth
  "/api/public/campaign-image/", // public campaign product images — needed for Instagram posting
  "/api/public/leads", // bridge-page lead capture — anonymous visitors, no auth
  "/api/public/unsubscribe", // one-click email unsubscribe link — anonymous visitors, no auth
  "/api/broadcast/sweep", // pg_cron backstop for Broadcast drip sequences, x-engine-secret gated
  // 6-hourly pg_cron domain re-verification, x-engine-secret gated. Was missing here since it
  // shipped, so the auth gate 307'd every unauthenticated pg_net POST to /login and the sweep
  // never once ran — confirmed live against production before this fix.
  "/api/domains/reverify-all",
  "/api/marketplace/refresh", // pg_cron daily marketplace-cache sweep, x-engine-secret gated
  "/b/", // public blog post pages — anonymous readers, no auth
  "/r/", // referral link capture — the visitor has no account yet, that's the point
];

export async function middleware(request: NextRequest) {
  // Custom-domain traffic (bring-your-own domains connected via /domains) must be handled BEFORE
  // the auth-gate logic below — it's always anonymous public traffic and must never redirect to
  // /login. A mismatch just means this Host isn't our own app's host; rewrite it to the catch-all
  // domain-serving route and return immediately, skipping route resolution for anything else
  // (dashboard, API routes, etc. are simply never reached for a mismatched Host).
  const host = request.headers.get("host") ?? "";
  const appHost = (() => {
    try {
      return new URL(process.env.NEXT_PUBLIC_APP_URL!).host;
    } catch {
      return "";
    }
  })();
  const isOwnHost = host === appHost || host.startsWith("localhost") || host.startsWith("127.0.0.1");
  const isAssetPath = request.nextUrl.pathname.startsWith("/_next");
  // A bridge page served under a tenant's custom domain runs its lead-capture fetch() from that
  // domain's own origin — a relative /api/public/leads call would otherwise get caught by the
  // rewrite below and 404 (no matching custom_domain_routes entry for an API path). Every route
  // under /api/public/ already does its own campaign-scoped authorization, so it's safe to resolve
  // regardless of the arriving Host — same reasoning as the /_next exemption, just for API routes
  // client-side JS running inside a /d/-served page needs to call back into.
  const isPublicApiPath = request.nextUrl.pathname.startsWith("/api/public/");

  if (!isOwnHost && !isAssetPath && !isPublicApiPath) {
    const url = request.nextUrl.clone();
    url.pathname = `/d${request.nextUrl.pathname}`;
    return NextResponse.rewrite(url);
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: AUTH_COOKIE_OPTIONS,
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;
  const isPublic =
    PUBLIC_EXACT_PATHS.includes(pathname) || PUBLIC_PREFIX_PATHS.some((p) => pathname.startsWith(p));
  // App Router serves these icon conventions as real routes, NOT from /_next — so the auth gate
  // was 307'ing them to /login for every logged-out visitor, i.e. the marketing site and every
  // public funnel/blog page had a broken favicon. (`favicon.ico` is already excluded by this
  // middleware's own matcher; these are not.) Confirmed live before fixing.
  const isAsset =
    pathname.startsWith("/_next") ||
    ICON_PATHS.includes(pathname) ||
    CRAWLER_PATHS.includes(pathname);

  if (!user && !isPublic && !isAsset) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
