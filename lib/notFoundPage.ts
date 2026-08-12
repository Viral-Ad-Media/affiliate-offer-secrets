// The 404 every PUBLIC route serves — funnel pages, funnel steps, the blog, custom domains and
// the signed-in preview. One function because there were eleven `new Response("Not found")` call
// sites across five files, and eleven copies of a security-relevant response is how one of them
// ends up saying something the others don't.
//
// TWO PROPERTIES, and both are the point:
//
// 1. IT IS NOT AN ORACLE. Every reason a public URL can fail — no such campaign, a campaign that
//    exists but isn't published, a blog post still in draft, a path mapped to no route, a
//    workspace subdomain serving another workspace's id — returns THE SAME BYTES. A campaign id
//    is an unguessable UUID and that unguessability IS the access control for these routes
//    (there is no RLS on an anonymous request), so a 404 that distinguished "wrong" from "not
//    yours" would hand an attacker a way to enumerate. Never add a reason, a code, or a
//    "check the link" hint that varies by cause.
//
// 2. IT IS UNBRANDED OFF OUR OWN HOST. A visitor who mistypes a path on a tenant's bring-your-own
//    domain is on the TENANT's site, not ours: putting "Affiliate Offer Secrets" and a link to it
//    on that page would advertise the tooling behind their funnel to their own traffic, and put
//    our name on a domain we don't own. So the branded variant is served only where the brand
//    genuinely belongs — the app's own host and its workspace subdomains.
import { classifyHost } from "@/lib/host";

// Light, always — same rule as every other publicly served page in this codebase (a real page
// shown to ad traffic never follows the operator's dark-mode preference). Self-contained, no
// external fetches, no script.
function shell(body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>Page not found</title>
<style>
  *, *::before, *::after { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    background: #fafafa;
    color: #1a1a1a;
    font: 16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .card { width: 100%; max-width: 420px; text-align: center; }
  .code { font-size: 13px; font-weight: 600; letter-spacing: .12em; text-transform: uppercase; color: #9a9a9a; }
  h1 { margin: 10px 0 0; font-size: 26px; line-height: 1.25; font-weight: 700; }
  p { margin: 10px 0 0; font-size: 15px; color: #5c5c5c; }
  .home {
    display: inline-block; margin-top: 22px; padding: 10px 18px; border-radius: 10px;
    background: #16a34a; color: #fff; font-size: 15px; font-weight: 600; text-decoration: none;
  }
  .home:hover { background: #15803d; }
  .brand { margin-top: 28px; font-size: 13px; color: #9a9a9a; }
  .brand a { color: #6b7280; text-decoration: none; }
  .brand a:hover { text-decoration: underline; }
</style>
</head>
<body><div class="card">${body}</div></body>
</html>`;
}

/**
 * The tenant-domain variant: says the page isn't there and stops. No brand, no outbound link —
 * there is nowhere to send this visitor that we have any business choosing, since the site they
 * were trying to reach belongs to someone else.
 */
function neutralBody(): string {
  return `<div class="code">404</div>
  <h1>Page not found</h1>
  <p>The page you're looking for isn't here. Check the link, or head back to where you came from.</p>`;
}

/** Our own host: the same message, plus the wordmark and a way back to the site. */
function brandedBody(): string {
  return `<div class="code">404</div>
  <h1>Page not found</h1>
  <p>This link may be wrong, expired, or point to something that isn't published.</p>
  <a class="home" href="/">Go to the homepage</a>
  <div class="brand">Affiliate Offer <strong style="color:#16a34a;font-weight:700">Secrets</strong></div>`;
}

/**
 * A 404 for a public route.
 *
 * Pass the request's `Host` header. Anything that isn't the app's own host (or one of its
 * workspace subdomains) gets the unbranded page — including an absent header, which is the
 * fail-safe direction: showing less is never the wrong call here.
 */
export function publicNotFound(host?: string | null): Response {
  const branded = classifyHost(host).kind !== "custom";
  return new Response(shell(branded ? brandedBody() : neutralBody()), {
    status: 404,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // A 404 is not indexed anyway; stated explicitly because these routes serve real
      // ad traffic and a crawler reaching one should be told plainly.
      "X-Robots-Tag": "noindex",
      // Never cache a not-found on these routes: publishing a funnel or a post is exactly the
      // thing that turns this response into a real page, and a cached 404 would outlive it.
      "Cache-Control": "no-store",
    },
  });
}
