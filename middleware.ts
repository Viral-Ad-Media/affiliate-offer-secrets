import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { AUTH_COOKIE_OPTIONS, REMEMBER_COOKIE, makeSessionScoped } from "@/lib/supabase/cookieOptions";
import { classifyHost } from "@/lib/host";

// Exact-match only — "/" as a prefix would match every path and disable the auth gate entirely.
const PUBLIC_EXACT_PATHS = [
  "/",
  "/login",
  "/reset-password", // password-recovery landing: reached from an email link, no session yet
  "/about",
  "/pricing",
  "/faq",
  "/contact",
  "/terms",
  "/privacy",
  // Meta's Data Deletion Request status URL. The person following it is a Facebook user who may
  // have no account here at all, so it must render with no session; the unguessable confirmation
  // code in the query string is the access control, same as the unsubscribe link's token.
  "/data-deletion",
];

// Icon files App Router generates as top-level routes. Browsers fetch these before (and without)
// any session, so they must never hit the auth gate.
const ICON_PATHS = ["/icon.svg", "/apple-icon.png", "/favicon.ico"];

// Same class of bug as ICON_PATHS: App Router serves app/robots.ts and app/sitemap.ts as real
// top-level routes, so the auth gate 307'd both to /login. Every crawler that asked this app for
// its robots.txt or sitemap got a redirect to a login page instead — which is exactly the traffic
// those two files exist to serve. Caught the day the real domain went live.
const CRAWLER_PATHS = ["/robots.txt", "/sitemap.xml"];

// What the auth gate actually turns away, as an explicit list.
//
// This file used to gate by OMISSION: anything not named public was redirected to /login. Safe by
// construction, and wrong for one specific case — a path that matches no route at all. A stale
// marketing link or a typo went to a login page instead of a 404, so an anonymous visitor could
// never reach the custom 404 and a crawler read every dead URL as a soft-404 redirect rather than
// a real one. Same bug class as ICON_PATHS and CRAWLER_PATHS above; this is the general form of it.
//
// Narrowing an auth gate deserves the reasoning written down, so: for everything under
// `app/(app)/` this was never the only gate. `app/(app)/layout.tsx` starts with
// `if (!user) redirect("/login")`, so those pages turn a session-less visitor away on their own
// and this list is defense-in-depth. `/preview` and `/admin` are the two that are NOT in that
// route group — `/preview` is a Route Handler that CLAUDE.md says relies on this gate, and
// `/admin` 404s non-superadmins from the database — so both are listed explicitly and by name.
//
// Adding a new authenticated top-level route means adding it here. Forgetting one does not expose
// data (RLS, and the layout's own redirect, both still apply) — it means an anonymous request
// reaches the page and gets bounced one layer later instead of at the edge.
const PROTECTED_PREFIXES = [
  "/dashboard",
  "/marketplace",
  "/products",
  "/product/",
  "/funnels",
  "/contacts",
  "/emails",
  "/sms",
  "/blog",
  "/ads",
  "/socials",
  "/analytics",
  "/audit",
  "/referrals",
  "/rewards",
  "/settings",
  "/billing",
  "/invite",
  // Not under app/(app)/ — no layout gate behind these, so this list is their only edge check.
  "/admin",
  "/preview",
  // Every API route that isn't explicitly public. Listed as one entry rather than being allowed to
  // fall through, deliberately: an unknown /api path 404ing is no better than it redirecting, and
  // leaving ~60 routes' edge behaviour to "they all check getUser() themselves" is a bet this
  // change has no reason to take. The public ones are exempted before this is consulted.
  "/api",
];

// Prefix-match — dynamic sub-paths (e.g. /p/[campaignId]/bridge) or server-to-server webhooks.
const PUBLIC_PREFIX_PATHS = [
  "/api/billing/webhook",
  "/api/engine/run",
  "/api/meta/deauthorize",
  // Meta's Data Deletion Request Callback. Unauthenticated by definition — Meta calls it
  // server-to-server — and authenticated instead by the signed_request HMAC inside the handler.
  "/api/meta/data-deletion",
  // Twilio's inbound-SMS webhook (STOP/HELP). Unauthenticated by definition — Twilio POSTs it
  // server-to-server — and authenticated instead by the X-Twilio-Signature HMAC inside the
  // handler. Missing from this list, the auth gate 307s it to /login and STOP is never honoured:
  // the same failure /api/domains/reverify-all had silently for weeks, on a route where the
  // consequence is continuing to text people who asked you to stop.
  "/api/sms/inbound",
  // The trial-conversion sweep, called by pg_cron through pg_net with x-engine-secret. Missing
  // from this list, the auth gate 307s it to /login and nothing is ever charged — same silent
  // class as /api/domains/reverify-all, on a route whose failure mode is "no revenue, no error".
  "/api/billing/charge-trials",
  // The blog's comment box — an anonymous HTML-form POST from public post pages, including ones
  // served on custom domains (the /api/public/ prefix is also exempt from the host rewrite, which
  // is what lets the same relative action work on both hosts — the lesson the leads route taught).
  "/api/public/comments",
  "/p/", // public bridge (lead-capture landing) pages — real ad destinations, no auth
  "/api/public/campaign-image/", // public campaign product images — needed for Instagram posting
  "/api/public/leads", // bridge-page lead capture — anonymous visitors, no auth
  "/api/public/unsubscribe", // one-click email unsubscribe link — anonymous visitors, no auth
  "/api/broadcast/sweep", // pg_cron backstop for Broadcast drip sequences, x-engine-secret gated
  // 6-hourly pg_cron domain re-verification, x-engine-secret gated. Was missing here since it
  // shipped, so the auth gate 307'd every unauthenticated pg_net POST to /login and the sweep
  // never once ran — confirmed live against production before this fix.
  "/api/domains/reverify-all",
  // Read-only dry run of the alias reconcile, x-engine-secret gated. Same caller shape as
  // reverify-all (server-to-server, no session), so the same exemption — without it the auth gate
  // 307s the POST to /login, the exact bug reverify-all shipped with.
  "/api/domains/reconcile-preview",
  "/api/marketplace/refresh", // pg_cron daily marketplace-cache sweep, x-engine-secret gated
  "/b/", // public blog post pages — anonymous readers, no auth
  "/r/", // referral link capture — the visitor has no account yet, that's the point
];

// Public API routes authorize themselves — a Stripe/Meta HMAC signature, or the x-engine-secret
// header — never by which hostname the request arrived on. So they must resolve on ANY host that
// reaches this deployment, not only the canonical one, and are exempt from the custom-domain
// rewrite below.
//
// This is not hypothetical tidiness. The Stripe webhook was registered against the project's old
// `*.vercel.app` hostname, which is still attached to the project: every delivery was classified
// as a tenant custom domain, rewritten to /d/api/billing/webhook, and answered 405 by the
// GET-only catch-all — so no payment ever granted access or credited an account, silently.
// Confirmed live (405 on the old host, 400 "missing signature" on the canonical one) before this
// fix. Third instance of this bug class in this file, after ICON_PATHS and CRAWLER_PATHS.
//
// Derived from the list above rather than hand-written, so a future public API route can't be
// added in one place and forgotten here. Deliberately API-only: /p/, /b/ and /r/ are CONTENT
// routes whose whole purpose is to be host-scoped (custom-domain serving, and the per-workspace
// subdomain scoping in lib/publicPage.ts) — exempting those would break both.
const PUBLIC_API_PREFIXES = PUBLIC_PREFIX_PATHS.filter((p) => p.startsWith("/api/"));

// Cross-HOST redirects must write the Location header by hand, and must never target bare
// localhost. Two layered problems, both observed live rather than theorized:
//
//   1. NextResponse.redirect() rewrites an absolute Location to a relative one whenever the
//      target origin matches what the server considers its own — so "send acme.localhost to
//      localhost/about" became "Location: /about", an infinite redirect to itself. A hand-set
//      header avoids the redirect() path...
//   2. ...but the server ALSO relativizes hand-set Location headers whose host it considers
//      loopback-equivalent: localhost and 127.0.0.1 both got stripped; www.localhost and any real
//      domain survived intact. So in dev the canonical host becomes www.localhost — browsers
//      resolve *.localhost to loopback with no config, it reaches the same dev server, and
//      classifyHost treats a www label as the app. Production APP_URL is never bare localhost,
//      so this substitution is inert there.
function redirectToHost(target: URL): NextResponse {
  if (target.hostname === "localhost") target.hostname = "www.localhost";
  return new NextResponse(null, { status: 307, headers: { Location: target.toString() } });
}

// Segment-boundary prefix match, shared by all three of the lists above.
//
// A bare startsWith over-matches at the segment boundary: "/api/domains/reverify-all" would also
// cover "/api/domains/reverify-all-not-really", so a path that is merely SPELLED like a public
// route inherited its exemption. Confirmed live before this fix — that URL was let through as
// public instead of being sent to /login. Nothing exploitable today (no such route exists, and
// each public route authorizes itself), but it is the same bug the matcher's (?:$|/) boundary
// closes, and the two must agree about what "a public path" means.
//
// An entry ending in "/" keeps plain prefix semantics — "/p/" is meant to cover "/p/{id}/bridge".
function matchesPrefix(pathname: string, prefixes: readonly string[]): boolean {
  return prefixes.some(
    (p) => pathname === p || pathname.startsWith(p.endsWith("/") ? p : `${p}/`)
  );
}

export async function middleware(request: NextRequest) {
  // Three kinds of host, decided BEFORE the auth-gate logic below (see lib/host.ts):
  //
  //   app       — the canonical host (or local dev). Everything below runs as it always has.
  //   workspace — {slug}.{root domain}. Serves the ordinary app; lib/workspace.ts scopes every
  //               query to that slug's workspace per request. Falls through to the session +
  //               auth-gate logic like the canonical host, with two exceptions handled here.
  //   custom    — a tenant's bring-your-own domain. Always anonymous public traffic; rewritten to
  //               the /d catch-all and returned immediately, so it can never redirect to /login
  //               and never reaches any other route.
  const pathname = request.nextUrl.pathname;
  const hostKind = classifyHost(request.headers.get("host"));
  const isAssetPath = pathname.startsWith("/_next");
  // A bridge page served under a tenant's custom domain runs its lead-capture fetch() from that
  // domain's own origin — a relative /api/public/leads call would otherwise get caught by the
  // rewrite below and 404 (no matching custom_domain_routes entry for an API path). Every route
  // under /api/public/ already does its own campaign-scoped authorization, so it's safe to resolve
  // regardless of the arriving Host — same reasoning as the /_next exemption, just for API routes
  // client-side JS running inside a /d/-served page needs to call back into.
  //
  // The same is true of every other public API route (see PUBLIC_API_PREFIXES): each verifies a
  // signature or a shared secret, so its authorization never depended on the hostname. The blanket
  // /api/public/ prefix stays as well, so a new route under it is covered even before someone
  // remembers to list it above.
  const isPublicApiPath =
    pathname.startsWith("/api/public/") || matchesPrefix(pathname, PUBLIC_API_PREFIXES);

  if (hostKind.kind === "custom" && !isAssetPath && !isPublicApiPath) {
    const url = request.nextUrl.clone();
    url.pathname = `/d${pathname}`;
    return NextResponse.rewrite(url);
  }

  if (hostKind.kind === "workspace") {
    // There is exactly one marketing site and one login page, and they live on the canonical
    // host. The bare subdomain root goes to the app instead — acme.{root}/ means "acme's
    // dashboard", not a duplicate homepage.
    if (pathname === "/") {
      const url = request.nextUrl.clone();
      url.pathname = "/dashboard";
      return NextResponse.redirect(url);
    }
    if (PUBLIC_EXACT_PATHS.includes(pathname)) {
      return redirectToHost(new URL(pathname + request.nextUrl.search, process.env.NEXT_PUBLIC_APP_URL));
    }
    // The blog is indexable on the canonical host (content marketing); serving the same posts on
    // a subdomain would be duplicate content. The renderers' canonical tags already point at the
    // canonical host, and this header makes the subdomain copy explicitly non-indexable.
    if (pathname.startsWith("/b/")) {
      const res = NextResponse.next({ request });
      res.headers.set("X-Robots-Tag", "noindex");
      return res;
    }
  }

  // The `(app)` layout redirects a canonical-host visit to the workspace's subdomain, and a
  // server component cannot see its own URL — the path rides along as a request header. Set
  // before NextResponse.next({ request }) captures the request, in both places that happens.
  request.headers.set("x-pathname", pathname + request.nextUrl.search);

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

  const isPublic =
    PUBLIC_EXACT_PATHS.includes(pathname) || matchesPrefix(pathname, PUBLIC_PREFIX_PATHS);
  // Segment-boundary matching, not a bare startsWith: "/ads" must cover "/ads" and "/ads/tiktok"
  // without also swallowing a future "/adsomething".
  const isProtected = matchesPrefix(pathname, PROTECTED_PREFIXES);
  // App Router serves these icon conventions as real routes, NOT from /_next — so the auth gate
  // was 307'ing them to /login for every logged-out visitor, i.e. the marketing site and every
  // public funnel/blog page had a broken favicon. (`favicon.ico` is already excluded by this
  // middleware's own matcher; these are not.) Confirmed live before fixing.
  const isAsset =
    pathname.startsWith("/_next") ||
    ICON_PATHS.includes(pathname) ||
    CRAWLER_PATHS.includes(pathname);

  // "Remember me" unchecked -> the auth cookie must die with the browser. This runs on every
  // response rather than once at sign-in because @supabase/ssr re-sets the cookie with its fixed
  // 400-day Max-Age each time it refreshes the access token (~hourly), which would silently make
  // the session persistent again. Only the expiry attributes are touched; the token is untouched.
  if (request.cookies.get(REMEMBER_COOKIE)?.value === "0") {
    makeSessionScoped(response.cookies);
  }

  // `isProtected` replaces the old "everything unlisted" rule — see PROTECTED_PREFIXES. A path
  // matching nothing now reaches the router and renders app/not-found.tsx with a real 404, which
  // is what a mistyped URL and a dead link deserve. isPublic is still consulted first, so a
  // public path under a protected prefix stays public.
  if (!user && !isPublic && !isAsset && isProtected) {
    // On a workspace subdomain, go straight to the canonical login — a same-host /login would
    // only bounce there via the marketing-path redirect above, one wasted hop.
    if (hostKind.kind === "workspace") {
      return redirectToHost(new URL("/login", process.env.NEXT_PUBLIC_APP_URL));
    }
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  return response;
}

// Every matched request runs this whole function, including the getUser() round trip — and on a
// serverless host that is billed as origin transfer once for the middleware and again for the
// route it falls through to. So the matcher is not just a performance knob: paths that gain
// nothing from middleware should never reach it.
//
// What is excluded, and why each one is safe:
//
//   _next/         — build assets. The body already treats these as `isAssetPath`/`isAsset`, so
//                    middleware's only effect on them was the cost of running.
//   favicon.ico    — already excluded before this change.
//   icon.svg,      — App Router serves these as real top-level routes, so browsers fetch them on
//   apple-icon.png   every page load with no session. ICON_PATHS keeps them exempt from the auth
//                    gate for any request that still reaches here.
//   api/public/    — anonymous by design; each route does its own campaign-scoped authorization.
//   the named      — Stripe/Meta HMAC or x-engine-secret. Each authorizes itself and none of them
//   webhook/cron     has ever needed a session, a rewrite, or the auth gate.
//   routes
//
// These mirror PUBLIC_API_PREFIXES (and the /api/public/ blanket) above. The two lists are
// separate because a Next matcher must be a static literal and PUBLIC_PREFIX_PATHS is a runtime
// array — but they cannot be kept in sync by wishing, so note which way each drift fails:
//
//   in PUBLIC_PREFIX_PATHS, not here  -> the route runs middleware, is exempted from the rewrite
//                                        by isPublicApiPath, and passes the gate as public. Works,
//                                        just pays for a middleware invocation. Safe.
//   here, not in PUBLIC_PREFIX_PATHS  -> the route skips the edge gate entirely. Only ever add a
//                                        path here once it is genuinely self-authorizing.
//
// Excluding the webhooks also permanently closes the bug documented at PUBLIC_API_PREFIXES: a
// delivery arriving on a non-canonical host can no longer be rewritten to /d and answered 405,
// because it never reaches the rewrite.
//
// NOT excluded, deliberately: /robots.txt and /sitemap.xml. A connected custom domain serves its
// OWN robots.txt and sitemap.xml through the /d rewrite (app/d/[[...path]]/route.ts) — taking
// them out of the matcher would skip that rewrite and answer with the app's copy instead.
// The two prefix entries end in "/" and match by prefix. Everything in the second group is an
// EXACT route and is followed by a (?:$|/) boundary — without it the lookahead is a bare prefix
// test, so a future "/api/engine/run-once" would silently inherit the exemption and skip the gate,
// which is the unsafe drift direction named above. Verified against both lists.
export const config = {
  matcher: [
    "/((?!_next/|api/public/|(?:favicon\\.ico|icon\\.svg|apple-icon\\.png|api/billing/webhook|api/engine/run|api/broadcast/sweep|api/marketplace/refresh|api/domains/reverify-all|api/meta/deauthorize|api/meta/data-deletion)(?:$|/)).*)",
  ],
};
