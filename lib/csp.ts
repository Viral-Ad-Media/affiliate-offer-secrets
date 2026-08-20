// Content-Security-Policy for the PUBLIC content routes — funnel pages (/p/, custom domains) and
// the blog (/b/, custom domains). Isomorphic: a plain string, no imports.
//
// Why this exists, and what it does NOT do. The `custom_html` block injects raw tenant markup into
// pages that serve on the app's own origin (see CLAUDE.md, "the one deliberate hole"). The full fix
// is a sandboxed iframe, which was declined to keep Elementor-style embeds working. This CSP is the
// agreed middle ground: it raises the bar without breaking legitimate third-party embeds (chat
// widgets, booking tools, video) or the code-owned tracking snippets (GA4/GTM/Clarity/Meta Pixel).
//
// What it BLOCKS, none of which has a legitimate use on these pages:
//   - object-src 'none'        — no Flash/Java/plugin objects
//   - base-uri 'self'          — a injected <base> can't re-root every relative URL on the page
//   - frame-ancestors 'self'   — the page can't be framed by another site (clickjacking a lead form)
//   - form-action 'self'       — an injected <form> can't POST the visitor's input to a third party
//   - http resources           — https-only everywhere, so no mixed-content exfil channel
//
// What it deliberately still ALLOWS (the embed-compatibility cost the user accepted): https scripts,
// styles, images, frames and fetch/XHR from any origin, plus 'unsafe-inline'/'unsafe-eval' (the
// tracking snippets and page scripts are inline, and GTM needs eval). So a same-origin fetch of the
// app's own API is NOT blocked — only a sandboxed iframe closes that, and it was declined. This is
// defense-in-depth, not a complete boundary; keep that framing when reasoning about it.
export const PUBLIC_CONTENT_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https:",
  "style-src 'self' 'unsafe-inline' https:",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data: https:",
  "connect-src 'self' https:",
  "frame-src https:",
  "media-src 'self' blob: https:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
].join("; ");
