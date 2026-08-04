// Which of the three kinds of host is this request arriving on?
//
// Before workspace subdomains there were only two, and `middleware.ts` expressed the distinction
// as a single boolean (`isOwnHost`) whose false branch meant "a tenant's bring-your-own domain,
// rewrite to /d". That boolean has no room for a third answer, and getting a third answer wrong is
// expensive: NEXT_PUBLIC_APP_URL naming the wrong host once 404'd every page of the app for a day.
// So the classification lives here, as one pure function with no I/O, rather than inline in the
// one file where a mistake takes the whole site down.
//
// Deliberately does NOT check that the workspace actually exists — that needs the database, and
// middleware already pays a network round trip for getUser() on every request. An unknown slug is
// resolved (and refused) where the workspace is resolved, in lib/workspace.ts.

export type HostKind =
  | { kind: "app" }
  | { kind: "workspace"; slug: string }
  | { kind: "custom" };

// Same shape workspaces.slug is already constrained to in 0041 — first and last character
// alphanumeric, hyphens only in the middle. That constraint was written for this: "it appears in
// URLs and, eventually, in a DNS label, which forbids underscores and leading/trailing hyphens."
const SLUG_RE = /^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])?$/;

// Never a workspace, whatever the reserved-slug table says — `www` is the canonical app host, and
// belt-and-braces here costs nothing.
const NEVER_A_WORKSPACE = new Set(["www"]);

export type HostConfig = { appHost: string; rootDomain: string };

// Read as separate statically-analyzable expressions: NEXT_PUBLIC_* is inlined at build time, so
// process.env can't be indexed dynamically here.
export function hostConfigFromEnv(): HostConfig {
  const appHost = (() => {
    try {
      return new URL(process.env.NEXT_PUBLIC_APP_URL!).host.toLowerCase();
    } catch {
      return "";
    }
  })();
  return { appHost, rootDomain: (process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "").toLowerCase() };
}

function stripPort(host: string): string {
  // IPv6 literals arrive bracketed ("[::1]:3400"); everything else is host[:port].
  if (host.startsWith("[")) return host.slice(0, host.indexOf("]") + 1);
  const colon = host.lastIndexOf(":");
  return colon === -1 ? host : host.slice(0, colon);
}

export function classifyHost(rawHost: string | null | undefined, cfg?: HostConfig): HostKind {
  const { appHost, rootDomain } = cfg ?? hostConfigFromEnv();
  const host = stripPort((rawHost ?? "").trim().toLowerCase());
  const bareAppHost = stripPort(appHost);

  if (!host) return { kind: "custom" };

  // The app's own canonical host, the bare apex, and local dev.
  if (host === bareAppHost || (rootDomain && host === rootDomain)) return { kind: "app" };
  if (host === "localhost" || host === "127.0.0.1" || host === "[::1]") return { kind: "app" };

  // A single label under the root domain — acme.affiliateoffersecrets.com. A deeper name
  // (a.b.rootDomain) is not a workspace: slugs can't contain dots, so it can only be someone
  // else's DNS pointed here.
  const suffixes: string[] = [];
  if (rootDomain) suffixes.push(`.${rootDomain}`);
  // `*.localhost` resolves in Chrome without any hosts-file entry, which is what makes this
  // testable in dev at all. It is also why the old `host.startsWith("localhost")` check was
  // wrong: acme.localhost:3400 does not start with "localhost", so it classified as a tenant
  // custom domain and rewrote to /d.
  suffixes.push(".localhost");

  for (const suffix of suffixes) {
    if (!host.endsWith(suffix)) continue;
    const label = host.slice(0, -suffix.length);
    if (!label || label.includes(".")) continue;
    // www.{root} / www.localhost is the canonical site, never a tenant's domain — classify as
    // app rather than falling through to the custom-domain rewrite. In production the appHost
    // equality above usually catches this first; www.localhost (the dev canonical host, see
    // middleware's redirectToHost) only ever reaches here.
    if (NEVER_A_WORKSPACE.has(label)) return { kind: "app" };
    if (!SLUG_RE.test(label)) continue;
    return { kind: "workspace", slug: label };
  }

  // Anything else is a tenant's bring-your-own domain: today's /d behavior, unchanged.
  return { kind: "custom" };
}

// The canonical origin for a workspace. Used for the www -> subdomain redirect, the workspace
// switcher's navigation, and the copy-link buttons that surface a tenant's branded URL.
//
// Falls back to the app host when no root domain is configured, so a deployment without the
// wildcard set up degrades to today's single-host behavior instead of emitting broken links.
export function workspaceOrigin(slug: string, cfg?: HostConfig): string {
  const { appHost, rootDomain } = cfg ?? hostConfigFromEnv();
  if (!rootDomain || !SLUG_RE.test(slug) || NEVER_A_WORKSPACE.has(slug)) {
    if (!appHost) return "";
    const scheme = stripPort(appHost) === "localhost" || stripPort(appHost) === "127.0.0.1" ? "http" : "https";
    return `${scheme}://${appHost}`;
  }
  // Dev runs on http and carries a port; production is https on the default port.
  const bare = stripPort(appHost);
  if (bare === "localhost" || bare === "127.0.0.1") {
    const port = appHost.includes(":") ? appHost.slice(appHost.lastIndexOf(":")) : "";
    return `http://${slug}.localhost${port}`;
  }
  return `https://${slug}.${rootDomain}`;
}
