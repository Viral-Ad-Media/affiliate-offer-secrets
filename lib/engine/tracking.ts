import { escapeHtml } from "./blockTree";

// Per-funnel analytics/tracking snippets (GA4, Google Tag Manager, Microsoft Clarity, Meta
// Pixel), injected into every publicly-served funnel page. Isomorphic, no I/O.
//
// The IDs are public by nature, but they're interpolated into inline <script> text served raw to
// unauthenticated ad traffic — so this file is a security boundary in the same class as
// image_data_url's anchored regex and the hoplink XSS fix: every ID is validated against a strict
// per-provider anchored pattern at save time (validateTracking, called by the settings route) AND
// re-checked at render time (renderTrackingHtml) — a stored value that doesn't match its pattern
// renders nothing, never "renders anyway." Never loosen these to startsWith/includes checks.

export type TrackingSettings = {
  ga4_id?: string | null;
  gtm_id?: string | null;
  clarity_id?: string | null;
  meta_pixel_id?: string | null;
  /**
   * Cookie/GDPR consent gate.
   *
   * When on, NONE of the tracking above runs until the visitor accepts — the snippets sit inert in
   * a <template> and are only injected on Accept. That is the whole point: a banner shown over an
   * already-fired Meta Pixel is not consent, it is a notice about something that already happened,
   * and under GDPR/ePrivacy it is arguably worse than no banner because it documents the breach.
   *
   * Decline stores the choice and injects nothing. There is no "consent by continuing to browse" —
   * that has not been valid in the EU since the 2019 Planet49 ruling.
   */
  consent_enabled?: boolean | null;
  consent_text?: string | null;
  consent_accept?: string | null;
  consent_decline?: string | null;
  /** Optional "read more" link, shown only if it's a real http(s) URL. */
  consent_policy_url?: string | null;
  /**
   * Raw <head>/<body>/<footer> snippets, stored VERBATIM and injected ONLY when the funnel serves
   * on the tenant's own VERIFIED CUSTOM DOMAIN — never on the shared /p/ origin, where the app's
   * own session cookie lives and a pasted script would be cross-tenant XSS by construction. That
   * host gate is the entire safety argument, and it lives at serve time (servePublicCampaignPage's
   * rawTracking flag): these are deliberately NOT baked into the stored bridge_html, which the
   * shared origin also serves. On a tenant's own domain it is the ordinary "my site, my script"
   * situation the custom-code block already documents. Not consent-gated — the app cannot parse
   * arbitrary markup to hold it back, so the point-of-entry copy says so.
   */
  custom_head?: string | null;
  custom_body?: string | null;
  custom_footer?: string | null;
};

const MAX_RAW_SNIPPET = 20_000;

export const TRACKING_FIELDS = ["ga4_id", "gtm_id", "clarity_id", "meta_pixel_id"] as const;
export type TrackingField = (typeof TRACKING_FIELDS)[number];

const PATTERNS: Record<TrackingField, RegExp> = {
  ga4_id: /^G-[A-Z0-9]{4,20}$/, // GA4 measurement id, e.g. G-ABC123XYZ0
  gtm_id: /^GTM-[A-Z0-9]{4,10}$/, // Tag Manager container id, e.g. GTM-ABCD123
  clarity_id: /^[a-z0-9]{4,32}$/i, // Clarity project id, e.g. abcd1234ef
  meta_pixel_id: /^\d{5,20}$/, // Meta Pixel id — numeric
};

const FIELD_LABELS: Record<TrackingField, string> = {
  ga4_id: "Google Analytics measurement ID (G-XXXXXXX)",
  gtm_id: "Google Tag Manager container ID (GTM-XXXXXXX)",
  clarity_id: "Microsoft Clarity project ID",
  meta_pixel_id: "Meta Pixel ID (numbers only)",
};

// Contextual patterns for pulling an ID out of a full pasted install snippet — platforms hand
// tenants a "paste this before </head>" code block, not a bare ID, so both are accepted. The
// extracted ID still faces the same strict PATTERNS check; the pasted markup itself is NEVER
// stored or rendered — funnel pages serve on the app's shared origin (where the app's own
// session cookies live), so injecting tenant-pasted <script> HTML verbatim would be cross-tenant
// XSS by construction. Extraction + code-owned snippets gives the paste-the-code UX without it.
const SNIPPET_PATTERNS: Record<TrackingField, RegExp[]> = {
  ga4_id: [/gtag\/js\?id=(G-[A-Z0-9]{4,20})/i, /['"](G-[A-Z0-9]{4,20})['"]/i],
  gtm_id: [/['"](GTM-[A-Z0-9]{4,10})['"]/i, /ns\.html\?id=(GTM-[A-Z0-9]{4,10})/i],
  clarity_id: [/clarity\.ms\/tag\/([a-z0-9]{4,32})/i, /["']script["']\s*,\s*["']([a-z0-9]{4,32})["']/i],
  meta_pixel_id: [/fbq\(\s*['"]init['"]\s*,\s*['"](\d{5,20})['"]/i, /facebook\.com\/tr\?id=(\d{5,20})/i],
};

// A bare ID, or an ID extracted from a pasted install snippet; null if neither works.
export function extractTrackingId(field: TrackingField, text: string): string | null {
  const trimmed = text.trim();
  const bare = field === "ga4_id" || field === "gtm_id" ? trimmed.toUpperCase() : trimmed;
  // Bare-ID path only for a single clean token — a pasted blob goes through extraction, where
  // clarity's permissive alphanumeric pattern would otherwise match arbitrary words.
  if (!/[\s<>"']/.test(trimmed) && PATTERNS[field].test(bare)) return bare;
  for (const re of SNIPPET_PATTERNS[field]) {
    const m = trimmed.match(re);
    if (m?.[1]) {
      const candidate = field === "ga4_id" || field === "gtm_id" ? m[1].toUpperCase() : m[1];
      if (PATTERNS[field].test(candidate)) return candidate;
    }
  }
  return null;
}

// Validates a settings payload from the funnel-settings UI. Each field accepts a bare ID or the
// platform's full pasted install snippet (the ID is extracted; the markup is discarded — see
// SNIPPET_PATTERNS above). Empty/missing fields clear that integration; a non-empty value no ID
// can be pulled from is a hard reject with a field-specific message (silently dropping a typo'd
// value would read as "tracking is broken"). Returns null when every field is empty — stored as
// NULL, not an empty object.
export function validateTracking(
  raw: unknown
): { ok: true; tracking: TrackingSettings | null } | { ok: false; error: string } {
  const body = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const tracking: TrackingSettings = {};
  let any = false;
  for (const field of TRACKING_FIELDS) {
    const v = typeof body[field] === "string" ? (body[field] as string).trim() : "";
    if (!v) continue;
    const id = v.length <= 20_000 ? extractTrackingId(field, v) : null;
    if (!id) {
      return { ok: false, error: `Couldn't find a valid ${FIELD_LABELS[field]} in what you entered` };
    }
    tracking[field] = id;
    any = true;
  }
  // Consent settings are text/booleans, not IDs — clamped, never pattern-matched, and they don't
  // count toward `any`: a consent block with no tags to gate renders nothing anyway.
  const clamp = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  if (body.consent_enabled === true) {
    tracking.consent_enabled = true;
    const url = clamp(body.consent_policy_url, 2000);
    if (url && !/^https?:\/\//i.test(url)) {
      return { ok: false, error: "The privacy policy link must start with http:// or https://" };
    }
    if (url) tracking.consent_policy_url = url;
    const text = clamp(body.consent_text, 400);
    const yes = clamp(body.consent_accept, 40);
    const no = clamp(body.consent_decline, 40);
    if (text) tracking.consent_text = text;
    if (yes) tracking.consent_accept = yes;
    if (no) tracking.consent_decline = no;
    any = true;
  }

  // Raw custom snippets: NO pattern check — they are raw markup by design (the host gate, not
  // sanitization, is the boundary). Length-capped and stored verbatim; whitespace preserved so a
  // pasted <script> keeps its formatting, but a blank/whitespace-only value clears the slot.
  for (const key of ["custom_head", "custom_body", "custom_footer"] as const) {
    const v = typeof body[key] === "string" ? (body[key] as string).slice(0, MAX_RAW_SNIPPET) : "";
    if (v.trim()) {
      tracking[key] = v;
      any = true;
    }
  }
  return { ok: true, tracking: any ? tracking : null };
}

/**
 * The raw custom snippets, verbatim — returned SEPARATELY from renderTrackingHtml on purpose:
 * these are spliced in only at serve time on a verified custom domain (servePublicCampaignPage),
 * never baked into the stored HTML that the shared /p/ origin also serves. Empty strings when a
 * slot is unset, so a caller can splice unconditionally.
 */
export function rawTrackingSnippets(tracking: TrackingSettings | null | undefined): {
  head: string;
  body: string;
  footer: string;
} {
  return {
    head: typeof tracking?.custom_head === "string" ? tracking.custom_head : "",
    body: typeof tracking?.custom_body === "string" ? tracking.custom_body : "",
    footer: typeof tracking?.custom_footer === "string" ? tracking.custom_footer : "",
  };
}

function valid(field: TrackingField, value: string | null | undefined): value is string {
  return typeof value === "string" && PATTERNS[field].test(value);
}

// Renders the standard, publicly-documented install snippets for whichever IDs are present and
// (re-)valid. `head` splices into <head>; `bodyStart` right after <body> (GTM's noscript iframe
// and the Pixel's noscript img, per each provider's own install instructions).
export function renderTrackingHtml(tracking: TrackingSettings | null | undefined): {
  head: string;
  bodyStart: string;
} {
  if (!tracking) return { head: "", bodyStart: "" };
  const head: string[] = [];
  const bodyStart: string[] = [];

  if (valid("gtm_id", tracking.gtm_id)) {
    head.push(
      `<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${tracking.gtm_id}');</script>`
    );
    bodyStart.push(
      `<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=${tracking.gtm_id}" height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>`
    );
  }

  if (valid("ga4_id", tracking.ga4_id)) {
    head.push(
      `<script async src="https://www.googletagmanager.com/gtag/js?id=${tracking.ga4_id}"></script>`,
      `<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${tracking.ga4_id}');</script>`
    );
  }

  if (valid("clarity_id", tracking.clarity_id)) {
    head.push(
      `<script>(function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);})(window,document,"clarity","script","${tracking.clarity_id}");</script>`
    );
  }

  if (valid("meta_pixel_id", tracking.meta_pixel_id)) {
    head.push(
      `<script>!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${tracking.meta_pixel_id}');fbq('track','PageView');</script>`
    );
    bodyStart.push(
      `<noscript><img height="1" width="1" style="display:none" src="https://www.facebook.com/tr?id=${tracking.meta_pixel_id}&ev=PageView&noscript=1"/></noscript>`
    );
  }

  const gated = tracking.consent_enabled === true;
  if (!gated) return { head: head.join("\n"), bodyStart: bodyStart.join("\n") };

  // Nothing to gate → no banner. A consent prompt on a page that sets no cookies is a dark
  // pattern in reverse: it trains people to dismiss prompts that did not need asking.
  if (head.length === 0) return { head: "", bodyStart: "" };

  const text = escapeHtml(
    (tracking.consent_text || "").trim() ||
      "We use cookies to measure how this page performs. You choose whether we do."
  );
  const yes = escapeHtml((tracking.consent_accept || "").trim() || "Accept");
  const no = escapeHtml((tracking.consent_decline || "").trim() || "Decline");
  const policy =
    typeof tracking.consent_policy_url === "string" && /^https?:\/\//i.test(tracking.consent_policy_url)
      ? `<a href="${escapeHtml(tracking.consent_policy_url)}" target="_blank" rel="noopener noreferrer">Privacy policy</a>`
      : "";

  // The snippets live in a <template>: inert until cloned, so nothing runs on load. The noscript
  // pixels are deliberately DROPPED when gating — a <noscript> image fires unconditionally and
  // cannot ask anyone anything, so keeping it would leak exactly what consent is meant to hold
  // back.
  return {
    head: `<template id="aos-consent-tags">${head.join("\n")}</template>`,
    bodyStart: `<div id="aos-consent" class="aos-consent" role="dialog" aria-live="polite" aria-label="Cookie choices" hidden>
  <p>${text} ${policy}</p>
  <div class="aos-consent-actions">
    <button type="button" data-consent="no">${no}</button>
    <button type="button" data-consent="yes" class="aos-consent-yes">${yes}</button>
  </div>
</div>
${CONSENT_SCRIPT}`,
  };
}

// Code-owned and constant — it reads no tenant text and builds no markup from data. Cloning a
// <template>'s scripts does not execute them, so each one is recreated; that is the whole trick
// that lets the snippets stay code-owned strings rather than something assembled in JS.
const CONSENT_SCRIPT = `<script>(function(){
var KEY="aos_consent", box=document.getElementById("aos-consent"), tpl=document.getElementById("aos-consent-tags");
if(!box||!tpl) return;
function run(){
  var frag=tpl.content.cloneNode(true), old=frag.querySelectorAll("script");
  for(var i=0;i<old.length;i++){
    var o=old[i], s=document.createElement("script");
    for(var j=0;j<o.attributes.length;j++){ s.setAttribute(o.attributes[j].name,o.attributes[j].value); }
    s.text=o.text; o.parentNode.replaceChild(s,o);
  }
  document.head.appendChild(frag);
}
var saved=null; try{ saved=localStorage.getItem(KEY); }catch(e){}
if(saved==="yes"){ run(); return; }
if(saved==="no"){ return; }
box.hidden=false;
box.addEventListener("click",function(e){
  var choice=e.target&&e.target.getAttribute&&e.target.getAttribute("data-consent");
  if(!choice) return;
  try{ localStorage.setItem(KEY,choice); }catch(err){}
  box.hidden=true;
  if(choice==="yes") run();
});
})();</script>`;
