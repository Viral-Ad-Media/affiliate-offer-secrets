// The one place the auth cookie's scope is decided. All three Supabase clients (browser, server,
// and middleware's inline one) pass this through — if they disagreed, the session would be
// written host-only by one client and domain-wide by another, and which cookie a request carries
// would depend on which client last touched it.
//
// NEXT_PUBLIC_COOKIE_DOMAIN (production: ".affiliateoffersecrets.com") makes the session cookie
// domain-wide, so signing in on www is signing in on every workspace subdomain. Unset (dev), the
// cookie stays host-only and nothing changes on localhost.
//
// The custom NAME is tied to the same variable on purpose. An old host-only cookie and a new
// domain-wide cookie with the same name are BOTH sent by the browser, and which one wins is
// undefined enough to produce an intermittent logged-out loop — the classic failure mode of
// widening a session cookie's domain in place. A new storage key makes every pre-existing cookie
// inert in one step: everyone is signed out exactly once, deterministically, instead of some
// sessions behaving ambiguously. Never reuse the default sb-* name once this has shipped.
import type { CookieOptionsWithName } from "@supabase/ssr";

const domain = process.env.NEXT_PUBLIC_COOKIE_DOMAIN;

export const AUTH_COOKIE_OPTIONS: CookieOptionsWithName | undefined = domain
  ? { name: "aos-auth", domain }
  : undefined;

// "Remember me". Unchecking it must make the session die with the browser, which means the auth
// cookie has to lose its Max-Age — and that CANNOT be done through cookieOptions: @supabase/ssr
// spreads the caller's options and then hard-overrides `maxAge: DEFAULT_COOKIE_OPTIONS.maxAge`
// (400 days) on the line after. Verified in node_modules/@supabase/ssr/dist/main/cookies.js.
// Passing maxAge there is silently ignored, so a checkbox built that way would do nothing at all.
//
// So the preference rides in its own cookie and middleware strips the persistence off the auth
// cookies on the way out. It has to run in middleware, not just at sign-in: the library re-sets
// the auth cookie (with the 400-day Max-Age again) every time it refreshes the access token, so a
// one-shot rewrite at login would silently become persistent again within the hour.
export const REMEMBER_COOKIE = "aos-remember";

// Supabase's default name when no cookie domain is configured (dev) is sb-<ref>-auth-token, and
// long values are split into .0/.1 chunks — hence prefix matching on both shapes.
function isAuthCookie(name: string): boolean {
  return name.startsWith(AUTH_COOKIE_OPTIONS?.name ?? "aos-auth") || name.startsWith("sb-");
}

// Structurally matches Next's ResponseCookies without importing next/server here — this module is
// also pulled into the browser bundle by lib/supabase/client.ts.
type MutableCookies = {
  getAll(): { name: string; value: string }[];
  set(cookie: { name: string; value: string }): unknown;
};

// Re-writes any auth cookie already staged on the response WITHOUT Max-Age/Expires, turning it
// into a session cookie. Only touches the expiry attributes — the token value, domain, path,
// sameSite and secure flags are carried through untouched, so this can't invalidate a session or
// orphan a cookie under a different scope.
export function makeSessionScoped(cookies: MutableCookies): void {
  for (const c of cookies.getAll()) {
    if (!isAuthCookie(c.name)) continue;
    // Drop only the two attributes that make a cookie survive browser close. Everything else —
    // value, domain, path, sameSite, secure, httpOnly — is carried through, so this can never
    // invalidate the session or strand a second cookie under a different scope.
    const { maxAge: _maxAge, expires: _expires, ...rest } = c as Record<string, unknown> & {
      name: string;
      value: string;
    };
    cookies.set(rest as { name: string; value: string });
  }
}

// For cookies this app sets by hand (OAuth state, sticky A/B assignment). Host-aware: a cookie
// being served on a tenant's bring-your-own custom domain must stay host-only — a Domain
// attribute naming a domain the page isn't on makes the browser reject the whole Set-Cookie,
// which would silently break the cookie everywhere it matters most.
export function cookieDomainForHost(host: string | null | undefined): string | undefined {
  if (!domain) return undefined;
  const bare = (host ?? "").toLowerCase().split(":")[0];
  const root = domain.replace(/^\./, "");
  return bare === root || bare.endsWith(`.${root}`) ? domain : undefined;
}
