// Pure, isomorphic HTML renderer for the bridge (lead-capture landing) page — no server-only
// imports, no I/O. Used by both the server-side campaign build pipeline (lib/engine/build.ts) and
// the client-side no-code page editor (components/PageEditor.tsx) so live preview and what
// actually gets published are always produced by the exact same function — never two copies that
// can drift. There used to be a second, separate "presell" page variant (a straight advertorial
// with no lead capture) — it's been merged into this one: the presell's full advertorial content
// (mechanism/benefits/proof/FAQ) now renders as step 1, before the opt-in form, instead of living
// on a second page nobody filled out a form on. `renderPresellHtml`/`campaigns.presell_html` no
// longer exist; `campaigns.presell_html` is left as an unread legacy column on old rows rather
// than a destructive migration (same precedent as `profiles.nickname`).

export type PageCopy = {
  headline: string;
  lead: string;
  mechanism: string;
  benefits: string[];
  proof: string;
  faq: { q: string; a: string }[];
  cta: string;
  landing_md: string;
};

export type ProductLike = { product_title: string };

export type Network = "clickbank" | "digistore24";

export const DISCLOSURE =
  "This page contains affiliate links. If you purchase through them, I may earn a commission at no extra cost to you.";

// Bridge pages now collect a real name + email (see app/api/public/leads/route.ts) — a real third
// party's PII, for the first time in this codebase. Cheap, consistent with how seriously this app
// already treats compliance (DISCLOSURE above is mandatory). Deliberately not a link to this app's
// own /privacy page: a bridge page represents the *tenant's* offer/brand, not ClickBank Studio's —
// the tenant's own downstream compliance (their privacy policy, consent mechanics, CAN-SPAM/CASL
// for their subsequent use of these leads) stays their responsibility, same division DISCLOSURE
// already establishes for affiliate-link rules.
export const LEAD_CONSENT_TEXT = "By submitting, you agree to be contacted about this offer.";

// Shared with lib/engine/build.ts's buildHoplinks() and the page-copy editor route, so both
// always derive the identical "tid=page" link the bridge page's reveal-step CTA points at.
//
// Every dynamic segment is URL-encoded — affiliateId in particular is now self-service, free-text
// user input (see network_connections in 0015_network_generalization.sql), not admin-set data, so
// this can no longer assume it's already URL-safe. Callers must still route the returned hoplink
// through escapeHtml() before interpolating it into an href attribute — encodeURIComponent() alone
// doesn't escape HTML-significant characters like `"` the way an attribute context needs.
export function buildHoplink(network: Network, affiliateId: string, vendorId: string, tid: string): string {
  const aff = encodeURIComponent(affiliateId);
  const vid = encodeURIComponent(vendorId);
  const channel = encodeURIComponent(tid);
  if (network === "digistore24") {
    return `https://www.checkout-ds24.com/redir/${vid}/${aff}/${channel}`;
  }
  return `https://hop.clickbank.net/?affiliate=${aff}&vendor=${vid}&tid=${channel}`;
}

// Deterministic markdown rebuild of the "Landing copy" tab from structured fields — used when
// the no-code editor saves an edit, so that tab stays in sync with the edited bridge page without
// another (costly, slower) LLM call. The engine's own generation still lets the
// LLM write landing_md directly for nicer prose transitions on first generation; only edits go
// through this mechanical rebuild.
export function renderLandingMd(copy: PageCopy): string {
  const benefits = copy.benefits.map((b) => `- ${b}`).join("\n");
  const faq = copy.faq.map((f) => `**${f.q}**\n\n${f.a}`).join("\n\n");
  return [
    `# ${copy.headline}`,
    copy.lead,
    `## How it works`,
    copy.mechanism,
    `## What you get`,
    benefits,
    copy.proof,
    `## Questions`,
    faq,
    `## ${copy.cta}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function escapeHtml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Step 1 is the merged-in former "presell" content: hook, image, the full mechanism/benefits/
// proof/FAQ advertorial, then the opt-in form. Step 2 is the reveal — a short confirmation plus
// the real hoplink CTA — shown only after a successful (or attempted, see the submit handler
// below) form submission.
export function renderBridgeHtml(
  product: ProductLike,
  copy: PageCopy,
  hoplink: string,
  imageDataUrl: string | null,
  campaignId: string
): string {
  const benefits = copy.benefits.map((b) => `<li>${escapeHtml(b)}</li>`).join("");
  const faq = copy.faq
    .map((f) => `<div class="faq-item"><h3>${escapeHtml(f.q)}</h3><p>${escapeHtml(f.a)}</p></div>`)
    .join("");
  const imageBlock = imageDataUrl
    ? `<img src="${escapeHtml(imageDataUrl)}" alt="${escapeHtml(product.product_title)}" style="max-width:100%;border-radius:12px;margin:24px 0;" />`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(copy.headline)}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; background:#fafafa; color:#1a1a1a; margin:0; padding:0; line-height:1.6; }
  .wrap { max-width: 680px; margin: 0 auto; padding: 40px 20px 80px; }
  h1 { font-size: 32px; line-height:1.2; margin-bottom: 16px; }
  h2 { font-size: 22px; margin-top: 32px; }
  .lead { font-size: 18px; color:#333; }
  ul { padding-left: 20px; }
  .faq-item { margin-bottom: 16px; }
  .faq-item h3 { font-size:16px; margin-bottom:4px; }
  .optin { max-width: 420px; margin: 40px auto 0; padding: 24px; background:#fff; border:1px solid #e5e5e5; border-radius:12px; text-align:center; }
  input { width:100%; box-sizing:border-box; padding:14px; margin:8px 0; border:1px solid #ccc; border-radius:8px; font-size:16px; }
  .cta { display:inline-block; background:#16a34a; color:#fff; border:none; padding:16px 32px; border-radius:8px; font-weight:600; font-size:18px; margin-top: 12px; cursor:pointer; width:100%; text-decoration:none; box-sizing:border-box; }
  .cta:hover { background:#15803d; }
  .hidden { display:none; }
  .reveal { max-width: 420px; margin: 40px auto 0; text-align:center; }
  .disclosure { margin-top: 48px; padding-top: 24px; border-top: 1px solid #e5e5e5; font-size: 12px; color: #888; }
  .optin .disclosure { margin-top: 12px; padding-top: 0; border-top: none; text-align: left; }
</style>
</head>
<body>
  <div class="wrap">
    <div id="step1">
      <h1>${escapeHtml(copy.headline)}</h1>
      <p class="lead">${escapeHtml(copy.lead)}</p>
      ${imageBlock}
      <h2>How it works</h2>
      <p>${escapeHtml(copy.mechanism)}</p>
      <h2>What you get</h2>
      <ul>${benefits}</ul>
      <p>${escapeHtml(copy.proof)}</p>
      <h2>Questions</h2>
      ${faq}
      <div class="optin">
        <!-- LEAD_CAPTURE_ENDPOINT: posts to /api/public/leads (app/api/public/leads/route.ts).
             This wiring — the endpoint URL and data-campaign-id below — is rendered by this
             function only; components/PageEditor.tsx never exposes it as an editable field, so
             it can't be redirected elsewhere via the no-code editor. -->
        <form id="leadForm" data-campaign-id="${escapeHtml(campaignId)}">
          <input id="leadFirstName" name="first_name" type="text" placeholder="First name" required />
          <input id="leadEmail" name="email" type="email" placeholder="Email address" required />
          <button type="submit" class="cta">${escapeHtml(copy.cta)}</button>
          <p class="disclosure">${LEAD_CONSENT_TEXT}</p>
        </form>
      </div>
    </div>
    <div id="step2" class="hidden reveal">
      <h1>${escapeHtml(copy.headline)}</h1>
      <a class="cta" href="${escapeHtml(hoplink)}">${escapeHtml(copy.cta)}</a>
    </div>
    <p class="disclosure">${DISCLOSURE}</p>
  </div>
  <script>
    document.getElementById('leadForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var form = e.target;
      var payload = {
        campaign_id: form.dataset.campaignId,
        first_name: document.getElementById('leadFirstName').value,
        email: document.getElementById('leadEmail').value
      };
      function advance() {
        document.getElementById('step1').classList.add('hidden');
        document.getElementById('step2').classList.remove('hidden');
      }
      // Always reveal the hoplink CTA regardless of save outcome — this is paid ad traffic;
      // losing a lead-save is far cheaper than losing a conversion on a dead-end page.
      fetch('/api/public/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).catch(function () {}).then(advance);
    });
  </script>
</body>
</html>`;
}
