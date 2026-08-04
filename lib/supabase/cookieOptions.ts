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
