// Pure, isomorphic HTML renderer for the bridge (lead-capture landing) page and funnel steps —
// no server-only imports, no I/O. Used by both the server-side campaign build pipeline
// (lib/engine/build.ts) and client-side editors so live preview and what actually gets published
// are always produced by the exact same function — never two copies that can drift.
//
// Phase O (freeform block-based page builder) moved the actual content model to a block tree —
// see lib/engine/blockTree.ts for the schema (SectionBlock/RowBlock/ColumnBlock/ElementBlock/
// LockedBlock) and renderBlockTree(). This file keeps three roles: (1) the legacy flat `PageCopy`
// shape below, which stays FOREVER as the Anthropic structured-output schema `stagePages` prompts
// against — retraining that JSON schema to emit a full block tree is a separate, much larger
// prompt-engineering effort, explicitly out of scope; (2) `normalizePageCopy()`, the permanent
// adapter from that flat shape (or an already-normalized tree) into a `PageBlockTree`; (3) the
// outer HTML document shell (doctype/head/style/submit-script) that both `renderBridgeHtml`/
// `renderFunnelStepHtml` own, splicing in `renderBlockTree()`'s body-fragment output.
//
// There used to be a second, separate "presell" page variant (a straight advertorial with no lead
// capture) — merged into this one long before Phase O; `renderPresellHtml`/`campaigns.presell_html`
// no longer exist, left as an unread legacy column (same precedent as `profiles.nickname`).

import {
  escapeHtml,
  styleToInlineCss,
  renderBlockTree,
  type PageBlockTree,
  type RenderCtx,
  type SectionBlock,
  type LockedBlock,
  type ElementBlock,
  type FormInputBlock,
  type FunnelStepType,
} from "./blockTree";

export { escapeHtml };
export * from "./blockTree";

// ---------------------------------------------------------------------------------------------
// Legacy flat shape — the permanent Anthropic authoring schema. Never remove; normalizePageCopy()
// below is the permanent adapter, not a one-time migration shim.
// ---------------------------------------------------------------------------------------------

export const SECTION_KEYS = ["lead", "mechanism", "benefits", "proof", "faq"] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];
export const DEFAULT_SECTION_ORDER: SectionKey[] = ["lead", "mechanism", "benefits", "proof", "faq"];

// Guards against corrupt/partial stored order (old data, a manually edited row, a key removed in
// a future version): keeps only recognized keys, then appends any missing ones in default order,
// so every section always renders exactly once regardless of what's stored.
export function resolveSectionOrder(order: string[] | null | undefined): SectionKey[] {
  const requested = order ?? DEFAULT_SECTION_ORDER;
  const valid = requested.filter((k): k is SectionKey => (SECTION_KEYS as readonly string[]).includes(k));
  const missing = SECTION_KEYS.filter((k) => !valid.includes(k));
  return [...valid, ...missing];
}

export type PageCopy = {
  headline: string;
  lead: string;
  mechanism: string;
  benefits: string[];
  proof: string;
  faq: { q: string; a: string }[];
  cta: string;
  sectionOrder?: SectionKey[];
};

export type ProductLike = { product_title: string };

export type Network = "clickbank" | "digistore24";

export const DISCLOSURE =
  "This page contains affiliate links. If you purchase through them, I may earn a commission at no extra cost to you.";

// Bridge pages collect a real name + email (see app/api/public/leads/route.ts) — a real third
// party's PII. Deliberately not a link to this app's own /privacy page: a bridge page represents
// the *tenant's* offer/brand, not ClickBank Studio's — the tenant's own downstream compliance
// stays their responsibility, same division DISCLOSURE already establishes for affiliate links.
export const LEAD_CONSENT_TEXT = "By submitting, you agree to be contacted about this offer.";

// Shared with lib/engine/build.ts's buildHoplinks() and the page-copy editor routes, so both
// always derive the identical "tid=page" link. Every dynamic segment is URL-encoded —
// affiliateId is self-service, free-text user input, not admin-set data. Callers must still route
// the returned hoplink through escapeHtml() before interpolating it into an href attribute —
// encodeURIComponent() alone doesn't escape HTML-significant characters like `"`.
export function buildHoplink(network: Network, affiliateId: string, vendorId: string, tid: string): string {
  const aff = encodeURIComponent(affiliateId);
  const vid = encodeURIComponent(vendorId);
  const channel = encodeURIComponent(tid);
  if (network === "digistore24") {
    return `https://www.checkout-ds24.com/redir/${vid}/${aff}/${channel}`;
  }
  return `https://hop.clickbank.net/?affiliate=${aff}&vendor=${vid}&tid=${channel}`;
}

// ---------------------------------------------------------------------------------------------
// normalizePageCopy — the permanent legacy-shape adapter. Pure, deterministic (sequential ids,
// never random, so identical input always produces identical output — no ambiguity when diffing
// before/after during the Phase O rollout). Detects `raw.version === 2` and passes it through;
// anything else (old flat PageCopy, null, malformed) is converted.
// ---------------------------------------------------------------------------------------------

function isPageBlockTree(raw: unknown): raw is PageBlockTree {
  return !!raw && typeof raw === "object" && (raw as any).version === 2 && Array.isArray((raw as any).blocks);
}

let legacyIdCounter = 0;
function legacyId(): string {
  return `legacy-${legacyIdCounter++}`;
}

export function normalizePageCopy(
  raw: unknown,
  imageDataUrl: string | null,
  opts?: { stepType?: FunnelStepType }
): PageBlockTree {
  if (isPageBlockTree(raw)) return raw;

  legacyIdCounter = 0; // deterministic per call — this function's ids are never persisted as-is
  // across separate calls, only within one resulting tree, so resetting per-call keeps output
  // reproducible for the same input without needing a shared global counter.

  const copy = (raw ?? {}) as Partial<PageCopy>;
  const headline = copy.headline ?? "";
  const lead = copy.lead ?? "";
  const mechanism = copy.mechanism ?? "";
  const benefits = copy.benefits ?? [];
  const proof = copy.proof ?? "";
  const faq = copy.faq ?? [];
  const cta = copy.cta || "Continue";

  const sectionHtml: Record<SectionKey, ElementBlock[]> = {
    lead: [
      { id: legacyId(), type: "paragraph", style: { fontSize: 18, color: "#333333" }, content: { text: lead } },
      ...(imageDataUrl
        ? ([{ id: legacyId(), type: "image", style: {}, content: { dataUrl: imageDataUrl, alt: "" } }] as ElementBlock[])
        : []),
    ],
    mechanism: [
      { id: legacyId(), type: "subheading", style: {}, content: { text: "How it works" } },
      { id: legacyId(), type: "paragraph", style: {}, content: { text: mechanism } },
    ],
    benefits: [
      { id: legacyId(), type: "subheading", style: {}, content: { text: "What you get" } },
      { id: legacyId(), type: "bullet_list", style: {}, content: { items: benefits } },
    ],
    proof: [{ id: legacyId(), type: "paragraph", style: {}, content: { text: proof } }],
    faq: [
      { id: legacyId(), type: "subheading", style: {}, content: { text: "Questions" } },
      ...faq.map(
        (f): ElementBlock => ({
          id: legacyId(),
          type: "faq_item",
          style: {},
          content: { question: f.q, answer: f.a },
        })
      ),
    ],
  };

  const sectionChildren = resolveSectionOrder(copy.sectionOrder).flatMap((key) => sectionHtml[key]);

  const umbrellaSection: SectionBlock = {
    id: legacyId(),
    type: "section",
    style: {},
    children: [{ id: legacyId(), type: "heading", style: {}, content: { text: headline } }, ...sectionChildren],
  };

  const blocks: (SectionBlock | LockedBlock)[] = [umbrellaSection];

  if (opts?.stepType === "upsell") {
    blocks.push({
      id: legacyId(),
      type: "decline_link",
      locked: "decline_link",
      style: {},
      content: { text: "No thanks, continue" },
    });
  }

  if (opts?.stepType) {
    // funnel step — no lead-capture form, just the primary CTA
    blocks.push({ id: legacyId(), type: "primary_cta", locked: "primary_cta", style: {}, content: { text: cta } });
  } else {
    // bridge page — lead-capture form, then the reveal CTA
    blocks.push({
      id: legacyId(),
      type: "lead_capture_form",
      locked: "lead_capture_form",
      style: {},
      content: { ctaText: cta },
      children: [] as FormInputBlock[],
    });
    blocks.push({ id: legacyId(), type: "primary_cta", locked: "primary_cta", style: {}, content: { text: cta } });
  }

  blocks.push({ id: legacyId(), type: "disclosure", locked: "disclosure", style: {}, content: {} });

  return { version: 2, blocks };
}

// ---------------------------------------------------------------------------------------------
// Document shell — shared <style> block covers every block type blockTree.ts's renderers emit.
// ---------------------------------------------------------------------------------------------

const PAGE_STYLE = `
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; background:#fafafa; color:#1a1a1a; margin:0; padding:0; line-height:1.6; }
  .wrap { max-width: 680px; margin: 0 auto; padding: 40px 20px 80px; }
  h1 { font-size: 32px; line-height:1.2; margin-bottom: 16px; }
  h2 { font-size: 22px; margin-top: 32px; margin-bottom: 8px; }
  ul { padding-left: 20px; }
  hr { border: none; border-top: 1px solid #e5e5e5; margin: 24px 0; }
  .block-img { max-width:100%; border-radius:12px; margin:24px 0; display:block; }
  .faq-item { margin-bottom: 16px; }
  .faq-item h3 { font-size:16px; margin-bottom:4px; }
  .row { display:flex; gap:24px; flex-wrap:wrap; }
  .row .col { flex:1; min-width:200px; }
  .icon-list-item, .image-list-item { display:flex; align-items:center; gap:12px; margin-bottom:12px; }
  .icon-list-item svg { flex-shrink:0; }
  .image-list-item img { width:48px; height:48px; object-fit:cover; border-radius:8px; flex-shrink:0; }
  .block-btn { display:inline-block; background:#16a34a; color:#fff; padding:12px 24px; border-radius:8px; font-weight:600; text-decoration:none; }
  .optin { max-width: 420px; margin: 40px auto 0; padding: 24px; background:#fff; border:1px solid #e5e5e5; border-radius:12px; text-align:center; }
  .optin input { width:100%; box-sizing:border-box; padding:14px; margin:8px 0; border:1px solid #ccc; border-radius:8px; font-size:16px; }
  .cta { display:inline-block; background:#16a34a; color:#fff; border:none; padding:16px 32px; border-radius:8px; font-weight:600; font-size:18px; margin-top: 12px; cursor:pointer; width:100%; text-decoration:none; box-sizing:border-box; }
  .cta:hover { background:#15803d; }
  .hidden { display:none; }
  .reveal { max-width: 420px; margin: 40px auto 0; text-align:center; }
  .decline-wrap { text-align:center; margin-top:16px; }
  .decline { color:#888; text-decoration:underline; font-size:14px; }
  .disclosure { margin-top: 48px; padding-top: 24px; border-top: 1px solid #e5e5e5; font-size: 12px; color: #888; }
  .optin .disclosure { margin-top: 12px; padding-top: 0; border-top: none; text-align: left; }
`;

// Step 1 is the advertorial (headline + content blocks) plus the opt-in form. Step 2 is the
// reveal — shown in place after a successful (or attempted, see the submit handler below) form
// submission — unless `nextStepUrl` (multi-step funnels) redirects elsewhere instead. Only the
// lead_capture_form and primary_cta LOCKED blocks toggle visibility on submit; every other block
// (headings, images, other sections) stays visible throughout — a deliberate simplification vs.
// the pre-Phase-O behavior of hiding/duplicating the entire step1/step2 subtree, made possible by
// no longer needing two full copies of the headline. Flagged explicitly in CLAUDE.md.
export function renderBridgeHtml(
  product: ProductLike,
  copy: unknown,
  hoplink: string,
  imageDataUrl: string | null,
  campaignId: string,
  nextStepUrl?: string | null
): string {
  const tree = normalizePageCopy(copy, imageDataUrl);
  const ctx: RenderCtx = {
    pageKind: "bridge",
    disclosureText: DISCLOSURE,
    leadConsentText: LEAD_CONSENT_TEXT,
    campaignId,
    primaryHref: hoplink,
    nextStepUrl: nextStepUrl ?? null,
    productTitle: product.product_title,
  };
  const title = titleOf(tree);
  const body = renderBlockTree(tree, ctx);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>${PAGE_STYLE}</style>
</head>
<body>
  <div class="wrap">
    ${body}
  </div>
  <script>
    document.getElementById('leadForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var form = e.target;
      var payload = { campaign_id: form.dataset.campaignId, first_name: '', email: '', extra_fields: {} };
      Array.prototype.forEach.call(form.querySelectorAll('[name]'), function (el) {
        if (el.name === 'first_name') payload.first_name = el.value;
        else if (el.name === 'email') payload.email = el.value;
        else if (el.name) payload.extra_fields[el.name] = el.value;
      });
      function advance() {
        if (form.dataset.nextStepUrl) {
          window.location.href = form.dataset.nextStepUrl;
          return;
        }
        if (form.parentElement) form.parentElement.classList.add('hidden');
        var reveal = document.getElementById('step2');
        if (reveal) reveal.classList.remove('hidden');
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

function titleOf(tree: PageBlockTree): string {
  for (const b of tree.blocks) {
    if (b.type === "section") {
      for (const c of b.children) {
        if (c.type === "heading") return c.content.text;
      }
    }
  }
  return "";
}

// Sibling to renderBridgeHtml() for the fixed-type pages a funnel can optionally chain after
// opt-in (0023_funnel_steps.sql) — same content-block advertorial, no lead-capture form (the
// visitor is already a lead by this point). thank_you/order render one CTA; upsell renders an
// Accept CTA plus a small Decline link. `primaryHref`/`declineHref` are resolved and baked in by
// the caller (the next step's public URL, or a real hoplink if this is the last step) — this
// function has no knowledge of funnel structure, matching renderBridgeHtml's own contract.
export function renderFunnelStepHtml(
  product: ProductLike,
  copy: unknown,
  stepType: FunnelStepType,
  primaryHref: string,
  imageDataUrl: string | null,
  declineHref?: string | null
): string {
  const tree = normalizePageCopy(copy, imageDataUrl, { stepType });
  const ctx: RenderCtx = {
    pageKind: "funnel_step",
    stepType,
    disclosureText: DISCLOSURE,
    leadConsentText: LEAD_CONSENT_TEXT,
    campaignId: "",
    primaryHref,
    declineHref: declineHref ?? null,
    productTitle: product.product_title,
  };
  const title = titleOf(tree);
  const body = renderBlockTree(tree, ctx);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>${PAGE_STYLE}
  .cta-wrap { max-width: 420px; margin: 40px auto 0; text-align:center; }
</style>
</head>
<body>
  <div class="wrap">
    <div class="cta-wrap">
      ${body}
    </div>
  </div>
</body>
</html>`;
}
