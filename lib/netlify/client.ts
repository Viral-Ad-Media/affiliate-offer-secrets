// Attaching a tenant's bring-your-own domain to this Netlify site, so their bridge pages serve
// under it. Replaces lib/vercel/client.ts, which called a Vercel project that no longer exists —
// every add/verify/remove was throwing.
//
// Two things about Netlify's API shape drive this whole file, and neither matches Vercel's:
//
//   1. There is no per-domain resource. A site has ONE `custom_domain` and an array of
//      `domain_aliases`, and you change them by PATCHing the site with the WHOLE array. So adding
//      one domain is a read-modify-write over a shared list, and two tenants adding at the same
//      moment can silently drop one another's domain.
//
//   2. There is no verification endpoint AT ALL. Vercel had two — /verify for ownership and
//      /config for "is DNS actually pointing here" — and isDomainFullyVerified required both.
//      Netlify reports neither, so the equivalent question has to be answered by resolving the
//      domain's DNS ourselves. That is arguably the more honest check anyway: it asks the thing we
//      actually care about ("does this name reach us right now") rather than what a provider's
//      records claim.
//
// The answer to (1) is NOT a lock. `custom_domains` is already the source of truth, so this
// reconciles the remote array FROM that table rather than appending to whatever was fetched a
// moment ago: two concurrent callers both compute the same desired set and converge, and a lost
// update self-heals the next time anything reconciles — including the 6-hourly reverify cron.

import { promises as dns } from "node:dns";
import { NETLIFY_DNS_A_RECORD, NETLIFY_DNS_APEX_TARGET, netlifyCnameTarget } from "./dns";

const API_BASE = "https://api.netlify.com/api/v1";

// Re-exported so a server-side caller has one import, while the values themselves live in the
// isomorphic ./dns module that the setup UI also reads. See there for why they are not duplicated.
export { NETLIFY_DNS_A_RECORD, NETLIFY_DNS_APEX_TARGET, netlifyCnameTarget };

export class NetlifyApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "NetlifyApiError";
    this.status = status;
  }
}

function getSiteId(): string {
  const id = process.env.NETLIFY_SITE_ID;
  if (!id) throw new Error("NETLIFY_SITE_ID is not set");
  return id;
}

function getApiToken(): string {
  const token = process.env.NETLIFY_AUTH_TOKEN;
  if (!token) throw new Error("NETLIFY_AUTH_TOKEN is not set");
  return token;
}

export function isNetlifyDomainsConfigured(): boolean {
  return !!(process.env.NETLIFY_SITE_ID && process.env.NETLIFY_AUTH_TOKEN);
}

async function netlifyFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${getApiToken()}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new NetlifyApiError(
      (data as { message?: string })?.message ?? `Netlify API error (${res.status})`,
      res.status
    );
  }
  return data as T;
}

type SiteDomains = { custom_domain: string | null; domain_aliases: string[] };

async function getSiteDomains(): Promise<SiteDomains> {
  const data = await netlifyFetch<{ custom_domain?: string | null; domain_aliases?: string[] }>(
    `/sites/${getSiteId()}`
  );
  return { custom_domain: data.custom_domain ?? null, domain_aliases: data.domain_aliases ?? [] };
}

/**
 * Sets the site's alias list to exactly `domains`.
 *
 * Callers pass the FULL desired set derived from custom_domains, never a delta — see the header.
 * The site's own primary custom_domain is filtered out: Netlify rejects a name that is both the
 * primary and an alias, and it is not a tenant domain anyway.
 */
export async function reconcileDomainAliases(domains: string[]): Promise<string[]> {
  const site = await getSiteDomains();
  const primary = (site.custom_domain ?? "").toLowerCase();
  const desired = Array.from(
    new Set(domains.map((d) => d.trim().toLowerCase()).filter((d) => d && d !== primary))
  ).sort();

  // Skip the write when nothing changes. This runs on a 6-hourly cron over every domain, and a
  // no-op PATCH would rewrite the site record — and bump its updated_at — on every tick.
  const current = [...site.domain_aliases].map((d) => d.toLowerCase()).sort();
  if (current.length === desired.length && current.every((d, i) => d === desired[i])) {
    return desired;
  }

  await netlifyFetch(`/sites/${getSiteId()}`, {
    method: "PATCH",
    body: JSON.stringify({ domain_aliases: desired }),
  });
  return desired;
}

/**
 * Asks Netlify to issue/renew the certificate covering the site's domains.
 *
 * Best-effort by design: Netlify only issues once DNS resolves, so calling this straight after
 * adding a domain usually fails and that failure means "DNS isn't ready yet", not "something is
 * broken". The caller must not treat it as fatal.
 */
export async function provisionSsl(): Promise<void> {
  await netlifyFetch(`/sites/${getSiteId()}/ssl`, { method: "POST" });
}

/**
 * Does this domain's DNS actually point at us right now?
 *
 * This is what replaces Vercel's verified + !misconfigured pair. Resolved here rather than asked
 * of Netlify, because Netlify exposes no per-domain state — and because this answers the question
 * that actually matters for serving traffic.
 *
 * Accepts any of the three shapes Netlify documents for external DNS: the A record, a CNAME to
 * this site's netlify.app hostname, or an apex ALIAS/ANAME flattened to the load balancer (which
 * resolves to A records we cannot enumerate, so it is matched by CNAME target where the provider
 * exposes one).
 *
 * Fails CLOSED. Any resolution error — NXDOMAIN, timeout, no records — is "not verified", never a
 * thrown exception: this is called in a loop by the reverify cron, and one unreachable domain must
 * not abort the sweep.
 */
export async function isDomainFullyVerified(domain: string): Promise<boolean> {
  const name = domain.trim().toLowerCase();
  if (!name) return false;

  const cnameTarget = netlifyCnameTarget().toLowerCase();

  const cnames = await dns.resolveCname(name).catch(() => [] as string[]);
  for (const raw of cnames) {
    const target = raw.replace(/\.$/, "").toLowerCase();
    if (target === NETLIFY_DNS_APEX_TARGET) return true;
    // EXACT hostname only. Matching any *.netlify.app would mark a domain verified while it points
    // at somebody else's Netlify site — this app would then claim to serve a name that resolves
    // elsewhere. With NEXT_PUBLIC_NETLIFY_SITE_HOSTNAME unset the fallback makes this equal the
    // apex target above, so subdomain-CNAME verification simply doesn't pass until it is
    // configured: conservative, and the setup panel still shows a record that does verify.
    if (target === cnameTarget) return true;
  }

  const a = await dns.resolve4(name).catch(() => [] as string[]);
  if (a.includes(NETLIFY_DNS_A_RECORD)) return true;

  // A record checks alone are NOT enough, and assuming they were is a bug this caught in
  // production. 75.2.60.5 is the address Netlify documents for EXTERNAL DNS; a domain hosted on
  // Netlify DNS gets regional edge addresses instead — this app's own domain resolves to
  // 63.176.8.218 and 35.157.26.135, both answering `server: Netlify` with a valid certificate.
  // Checking only the documented IP would have reported every Netlify-DNS domain as unverified
  // forever, which is the worst shape of wrong here: the tenant's setup is correct and the product
  // says it isn't.
  //
  // So fall back to asking the domain itself. `server: Netlify` proves the name reaches Netlify's
  // edge whatever address it resolved to. It does NOT prove the domain reaches THIS site — but
  // that half is already guaranteed by construction, because syncDomainAliases is what put the
  // domain on this site's alias list and Netlify only serves a name from the site holding it.
  return await reachesNetlifyEdge(name);
}

/**
 * Does an HTTPS request to this domain land on Netlify's edge?
 *
 * HEAD, short timeout, redirects not followed — the status is irrelevant (an unattached domain
 * answers 404 from the same edge), only the `server` header matters. Fails closed on any error,
 * same as the DNS checks above: the reverify cron walks every domain and must not abort on one.
 */
async function reachesNetlifyEdge(domain: string): Promise<boolean> {
  try {
    const res = await fetch(`https://${domain}/`, {
      method: "HEAD",
      redirect: "manual",
      signal: AbortSignal.timeout(8_000),
    });
    return (res.headers.get("server") ?? "").toLowerCase().includes("netlify");
  } catch {
    return false;
  }
}
