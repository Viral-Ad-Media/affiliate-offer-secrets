import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

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

// Prefix-match — dynamic sub-paths (e.g. /p/[campaignId]/bridge) or server-to-server webhooks.
const PUBLIC_PREFIX_PATHS = [
  "/api/billing/webhook",
  "/api/engine/run",
  "/api/meta/deauthorize",
  "/p/", // public bridge (lead-capture landing) pages — real ad destinations, no auth
  "/api/public/campaign-image/", // public campaign product images — needed for Instagram posting
  "/api/public/leads", // bridge-page lead capture — anonymous visitors, no auth
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
  const isAsset = pathname.startsWith("/_next");

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
