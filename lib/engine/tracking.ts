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
};

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
  return { ok: true, tracking: any ? tracking : null };
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

  return { head: head.join("\n"), bodyStart: bodyStart.join("\n") };
}
