// The DNS targets a tenant points their own domain at. ISOMORPHIC — no node:dns, no token — so
// components/DomainsPanel.tsx can import it. lib/netlify/client.ts, which resolves DNS and holds
// the API token, is server-only and imports these from here.
//
// Split out for a specific reason: the previous Vercel equivalents were exported from the API
// client AND hardcoded a second time as string literals in DomainsPanel, so the exported constants
// had no consumers at all and the two copies could drift silently. A tenant following stale
// instructions points their DNS at nothing and the domain simply never verifies — which reads as
// "your product is broken", not "that value moved". One definition, imported by both.

/** Apex domains, where the provider offers no ALIAS/ANAME record type. */
export const NETLIFY_DNS_A_RECORD = "75.2.60.5";

/** Apex domains, where the provider DOES support ALIAS/ANAME/flattened-CNAME. Preferred. */
export const NETLIFY_DNS_APEX_TARGET = "apex-loadbalancer.netlify.com";

/**
 * What a SUBDOMAIN CNAMEs to: this site's own netlify.app hostname.
 *
 * NEXT_PUBLIC_ because the setup instructions render in the browser, and public by nature — it is
 * the site's own address. Falls back to the apex load balancer so the panel always shows something
 * valid rather than an empty record; a tenant who follows the fallback still reaches Netlify.
 */
export function netlifyCnameTarget(): string {
  return (process.env.NEXT_PUBLIC_NETLIFY_SITE_HOSTNAME ?? "").trim() || NETLIFY_DNS_APEX_TARGET;
}
