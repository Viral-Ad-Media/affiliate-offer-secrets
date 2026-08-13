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
  contentWidthOf,
  BRANCH_RESOLVE_JS,
  type PageBlockTree,
  type RenderCtx,
  type SectionBlock,
  type RowBlock,
  type ColumnBlock,
  type LockedBlock,
  type ElementBlock,
  type FormInputBlock,
  type FunnelStepType,
} from "./blockTree";
import { renderTrackingHtml, type TrackingSettings } from "./tracking";
import { themeToCssVars } from "./pageTheme";

export { escapeHtml };
export * from "./blockTree";
export { validateTracking, renderTrackingHtml, TRACKING_FIELDS, type TrackingSettings } from "./tracking";

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
// the *tenant's* offer/brand, not Affiliate Offer Secrets's — the tenant's own downstream compliance
// stays their responsibility, same division DISCLOSURE already establishes for affiliate links.
export const LEAD_CONSENT_TEXT = "By submitting, you agree to be contacted about this offer.";

// Shared with lib/engine/build.ts's buildHoplinks() and the page-copy editor routes, so both
// always derive the identical "tid=page" link. Every dynamic segment is URL-encoded —
// affiliateId is self-service, free-text user input, not admin-set data. Callers must still route
// the returned hoplink through escapeHtml() before interpolating it into an href attribute —
// encodeURIComponent() alone doesn't escape HTML-significant characters like `"`.
/**
 * The affiliate link for one channel.
 *
 * `override` is a tenant-supplied link (products.hoplink_override) that replaces the derived one
 * wholesale — used when the constructed link is wrong for a given offer. It is returned VERBATIM,
 * including for per-channel calls, which means the per-channel `tid` is deliberately lost while an
 * override is set. That is the honest behaviour: the tid convention is specific to each network's
 * own URL shape (ClickBank's `tid` query param, Digistore24's campaignkey path segment), and an
 * arbitrary pasted URL gives no reliable way to know where — or whether — a tracking token belongs.
 * Guessing would produce links that look tracked and silently aren't. The UI says so at the point
 * of entry.
 *
 * The value is scheme-constrained at the database (0064) and escapeHtml'd at every interpolation
 * point, same three-layer treatment as the derived link.
 */
export function buildHoplink(
  network: Network,
  affiliateId: string,
  vendorId: string,
  tid: string,
  override?: string | null
): string {
  if (typeof override === "string" && override.trim()) return override.trim();
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

/**
 * Deterministic 32-bit hash (FNV-1a). Seeds the layout choices below.
 *
 * Layout has to VARY between products or every generated page is the same shape, and it has to be
 * STABLE for one product or a rebuild silently rearranges a page someone has been running traffic
 * to. Hashing the headline gives both: different copy lands on a different arrangement, the same
 * copy always lands on the same one. Deliberately not Math.random — this function's determinism is
 * a documented property, and a page that reshuffles on every render is not reviewable.
 */
/**
 * Icons that can sit beside a benefit without contradicting it. A deliberate SUBSET of
 * ALLOWED_ICON_NAMES — that list also contains `alert-circle` and `x-circle`, which next to "no
 * equipment needed" would read as a warning rather than a tick.
 */
const BENEFIT_ICONS = ["check-circle", "check", "star", "shield", "zap", "sparkles", "award", "target", "thumbs-up", "heart"];

function layoutSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Splits items into `n` contiguous, as-even-as-possible groups. Reading order across columns. */
function splitInto<T>(items: T[], n: number): T[][] {
  const out: T[][] = Array.from({ length: n }, () => []);
  const per = Math.ceil(items.length / n);
  items.forEach((item, i) => out[Math.min(n - 1, Math.floor(i / per))].push(item));
  return out;
}

export function normalizePageCopy(
  raw: unknown,
  imageDataUrl: string | null,
  opts?: { stepType?: FunnelStepType; siteName?: string; extraImages?: string[] }
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

  // ---------------------------------------------------------------------------------------
  // Layout. The AI still returns the same flat fields it always has — retraining that schema to
  // emit a block tree is explicitly out of scope (see the note at the top of this file) — so the
  // arrangement is composed HERE, from content the model already produced.
  //
  // Before this, everything went into one umbrella section as a single column of blocks: the
  // page builder had sections, rows and columns, and generated pages used none of them. Now each
  // part of the page is its own root-level section (which also makes them individually draggable
  // in the editor), and the two parts with repeating content — benefits and FAQ — become real
  // multi-column rows.
  //
  // Column counts are driven by how MUCH content there is, not by taste: three bullets read well
  // as three columns, two do not, and one always stays full width. Where more than one
  // arrangement genuinely works, `seed` picks between them so two products don't come out
  // identically shaped.
  // ---------------------------------------------------------------------------------------
  const seed = layoutSeed(headline || lead || "aos");

  const col = (children: ElementBlock[]): ColumnBlock => ({
    id: legacyId(),
    type: "column",
    style: {},
    children,
  });
  // The validator hard-rejects a row whose column count doesn't match its layout, so the two are
  // always derived from the same number here rather than passed separately.
  const rowOf = (groups: ElementBlock[][]): RowBlock => ({
    id: legacyId(),
    type: "row",
    layout: groups.length === 3 ? "3col" : groups.length === 2 ? "2col" : "1col",
    style: {},
    columns: groups.map(col),
  });

  const sectionOf = (children: (RowBlock | ElementBlock)[]): SectionBlock => ({
    id: legacyId(),
    type: "section",
    style: {},
    children,
  });

  /**
   * Benefits as an icon list rather than bullets.
   *
   * A tick beside a benefit is the single most recognisable landing-page convention there is, and
   * the block type already existed — generated pages just never used it. Icons are picked from
   * `BENEFIT_ICONS`, a subset of the allowlist chosen because each one reads as a POSITIVE (a
   * tick, a shield, a spark); the full set includes `alert-circle` and `x-circle`, which beside a
   * benefit would say the opposite of what the line says.
   *
   * Which icon a line gets is seeded rather than fixed, so pages don't all show the same column of
   * identical ticks, and `offset` keeps the sequence running across a row's columns instead of
   * restarting in each one. An unknown name could never render anyway — the renderer looks it up
   * in ICON_SVG_PATHS and emits nothing on a miss — but these all come from that same map.
   */
  const iconList = (items: string[], offset = 0): ElementBlock => ({
    id: legacyId(),
    type: "icon_list",
    style: {},
    content: {
      items: items.map((text, i) => ({
        icon: BENEFIT_ICONS[(seed + offset + i) % BENEFIT_ICONS.length],
        text,
      })),
    },
  });

  /**
   * The nth EXTRA image, or null. The hero already used the first one, so these are the tail —
   * `extraImages` is passed pre-sliced by the caller. Each is consumed at most once: a section
   * asks for a specific index, so two sections can never render the same picture.
   */
  const extras = (opts?.extraImages ?? []).filter((u) => typeof u === "string" && u);
  const extraImage = (n: number): ElementBlock | null =>
    extras[n] ? { id: legacyId(), type: "image", style: {}, content: { dataUrl: extras[n], alt: "" } } : null;

  const sectionLayout: Record<SectionKey, () => (RowBlock | ElementBlock)[]> = {
    // Hero. With an image it becomes a real two-column split — copy beside the product shot —
    // which is the arrangement a single column could never express. Without one it stays full
    // width rather than leaving an empty column.
    lead: () => {
      const [para, image] = [sectionHtml.lead[0], sectionHtml.lead[1]];
      if (!image) return [para];
      // Which side the image sits on is the one genuinely free choice here, so it varies.
      return [seed % 2 === 0 ? rowOf([[para], [image]]) : rowOf([[image], [para]])];
    },
    // A single explanatory paragraph — paired with a second product shot when one was fetched, so
    // the middle of the page isn't an unbroken wall of text.
    mechanism: () => {
      const img = extraImage(0);
      if (!img) return sectionHtml.mechanism;
      const [sub, para] = sectionHtml.mechanism;
      // Opposite side to the hero, so the two rows don't stack into one column of images.
      return [sub, seed % 2 === 0 ? rowOf([[img], [para]]) : rowOf([[para], [img]])];
    },
    // Benefits are the natural grid: the heading stays full width above a row of columns, each
    // holding its share of the bullets as its own list.
    benefits: () => {
      const [heading, list] = sectionHtml.benefits;
      const items = benefits.filter((b) => b.trim());
      if (items.length < 2) return [heading, iconList(items)];
      // 3 columns only when they divide sensibly and each still gets something to say.
      const cols = items.length % 3 === 0 && items.length >= 3 ? 3 : items.length >= 4 && seed % 3 === 0 ? 3 : 2;
      const groups = splitInto(items, Math.min(cols, items.length));
      return [heading, rowOf(groups.map((group, gi) => [iconList(group, gi * 100)]))];
    },
    proof: () => {
      const img = extraImage(1);
      return img ? [...sectionHtml.proof, img] : sectionHtml.proof;
    },
    // FAQ pairs sit side by side once there are enough of them to make two columns balance.
    faq: () => {
      const [heading, ...items] = sectionHtml.faq;
      if (items.length < 4) return [heading, ...items];
      const groups = splitInto(items, 2);
      return [heading, rowOf(groups)];
    },
  };

  const heroHeading: ElementBlock = {
    id: legacyId(),
    type: "heading",
    style: {},
    content: { text: headline },
  };

  const order = resolveSectionOrder(copy.sectionOrder);
  const contentSections: SectionBlock[] = order
    .map((key, i) => {
      const children = sectionLayout[key]().filter(Boolean);
      // The headline belongs to whichever section comes first, so reordering sections in the
      // editor can never leave the page without one at the top.
      return sectionOf(i === 0 ? [heroHeading, ...children] : children);
    })
    // A section whose only content was an empty string renders as a gap; drop it rather than ship
    // an empty band. `pruneEmptySections` does the same job for hand-built funnels.
    .filter((s) => s.children.length > 0);

  const blocks: (SectionBlock | LockedBlock)[] = contentSections.length
    ? contentSections
    : [sectionOf([heroHeading])];

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
    // Bridge page — the lead-capture form only. There is deliberately no separate primary_cta
    // block any more: the form's own afterSubmit action sends the lead to the offer, so a second
    // button that appeared only after submitting was a duplicate of the one already on screen.
    // `offer` resolves at render time to the next funnel step when one exists, else the hoplink —
    // exactly where the old reveal-and-click CTA pointed, so this changes the number of clicks,
    // not the destination.
    const form: LockedBlock = {
      id: legacyId(),
      type: "lead_capture_form",
      locked: "lead_capture_form",
      style: {},
      content: { ctaText: cta, afterSubmit: { kind: "offer" }, successText: "Thanks — check your inbox." },
      children: [] as FormInputBlock[],
    };
    // WHERE the form sits varies, because "always at the very bottom" is a real cost on a long
    // page: a reader who is convinced by the second section has to scroll past everything else to
    // act. Two placements, both of which keep the form after enough copy to have made the case —
    // never before the first section, which would ask for an email before saying anything.
    //
    // Only the position varies. The form itself, its consent text and its afterSubmit action are
    // identical either way; this is not an A/B test and must not be mistaken for one (that is
    // bridge_variants' job, and it measures results — this does not).
    const midpoint = Math.max(1, Math.ceil(blocks.length / 2));
    if (blocks.length >= 4 && seed % 3 === 0) blocks.splice(midpoint, 0, form);
    else blocks.push(form);
  }

  // A footer, when there is something real to put in it.
  //
  // Links are deliberately NOT generated. A footer's links are Privacy/Terms/Contact for whoever
  // runs the page, and this code has no idea what those URLs are — emitting `#` placeholders would
  // ship dead links onto a page taking paid ad traffic, which is worse than no links at all. The
  // block is there with the operator's own name in it; adding links is one drag in the editor.
  //
  // The affiliate disclosure is NOT part of this: it stays its own locked block, and the renderer
  // hoists it below everything regardless of where it sits (see renderBlockTree).
  const siteName = (opts?.siteName ?? "").trim();
  if (siteName) {
    blocks.push(
      sectionOf([
        { id: legacyId(), type: "footer", style: {}, content: { text: siteName, links: [] } } as ElementBlock,
      ])
    );
  }

  blocks.push({ id: legacyId(), type: "disclosure", locked: "disclosure", style: {}, content: {} });

  return { version: 2, blocks };
}

// ---------------------------------------------------------------------------------------------
// Document shell — shared <style> block covers every block type blockTree.ts's renderers emit.
// ---------------------------------------------------------------------------------------------

const PAGE_STYLE = `
  /* Every themeable rule reads a --t-* var with its PRE-THEME value as the fallback, so a page
     with no theme renders exactly as it did before themes existed. See lib/engine/pageTheme.ts —
     only clamped numbers and #rrggbb strings ever reach these variables. */
  body { font-family: var(--t-body-font, -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif); background:var(--t-bg,#fafafa); color:var(--t-text,#1a1a1a); margin:0; padding:0; line-height:var(--t-line-height,1.6); font-size:var(--t-base-size,16px); }
  /* width:90% gives narrow screens a gutter with no media query; the px cap stops a wide
     monitor stretching a line of text across the whole display. --content-w is emitted per
     page from the tree's own contentWidth (see contentWidthOf), so PAGE_STYLE stays a const. */
  .wrap { width: 90%; max-width: var(--content-w, 1280px); margin: 0 auto; padding: 40px 20px 80px; }
  h1 { font-family:var(--t-heading-font,inherit); font-size: var(--t-h1-size,32px); font-weight:var(--t-heading-weight,700); line-height:1.2; margin-bottom: 16px; }
  h2 { font-family:var(--t-heading-font,inherit); font-size: var(--t-h2-size,22px); font-weight:var(--t-heading-weight,700); margin-top: 32px; margin-bottom: 8px; }
  ul { padding-left: 20px; }
  hr { border: none; border-top: 1px solid var(--t-border,#e5e5e5); margin: 24px 0; }
  .block-img { max-width:100%; border-radius:12px; margin:24px 0; display:block; }
  /* Placing a narrowed image. Auto margins, because .block-img is display:block and text-align
     cannot move it. DUPLICATED in the other stylesheet; change both. */
  .img-wrap-center > .block-img { margin-left:auto; margin-right:auto; }
  .img-wrap-right > .block-img { margin-left:auto; margin-right:0; }
  /* 16:9 responsive frame — the wrapper owns the ratio so an iframe (which has no intrinsic
     size) and a <video> (which does) lay out identically. */
  .video-wrap { position:relative; width:100%; margin:24px 0; padding-top:56.25%; border-radius:12px; overflow:hidden; background:#000; }
  .video-wrap iframe, .video-wrap video { position:absolute; inset:0; width:100%; height:100%; border:0; display:block; }
  .testimonial { margin:24px 0; padding:20px 24px; border-left:4px solid var(--t-primary,#e0e0e0); background:var(--t-surface,#fafafa); border-radius:8px; }
  .testimonial blockquote { margin:0; font-size:17px; line-height:1.6; font-style:italic; color:#333; }
  .testimonial figcaption { margin-top:10px; font-size:14px; color:#666; }
  .testimonial .tm-name { font-weight:600; color:#1a1a1a; }
  .testimonial .tm-role { display:block; font-size:13px; color:#888; }
  .testimonial .tm-avatar { width:64px; height:64px; margin:0 0 12px; border-radius:50%; overflow:hidden; }
  .testimonial .tm-avatar img { width:100%; height:100%; object-fit:cover; display:block; }
  .testimonial .tm-media.video-wrap { margin:0 0 14px; }
  .carousel { display:flex; gap:12px; overflow-x:auto; scroll-snap-type:x mandatory; scroll-behavior:smooth; margin:24px 0; padding-bottom:8px; -webkit-overflow-scrolling:touch; }
  .carousel .slide { flex:0 0 88%; scroll-snap-align:center; margin:0; }
  .carousel .slide img { width:100%; height:auto; display:block; border-radius:12px; }
  .carousel .slide figcaption { margin-top:8px; font-size:14px; color:#666; text-align:center; }
  .carousel:focus-visible { outline:2px solid #16a34a; outline-offset:4px; }
  @media (min-width:700px) { .carousel .slide { flex-basis:60%; } }
  /* Responsive visibility — set per block in the editor's own settings panel. Breakpoints match
     the editor's device toggle: mobile below 640, tablet 640-1023, desktop 1024 and up.
     !important so a future inline display value from a style key cannot silently defeat it.
     THIS BLOCK IS DUPLICATED in lib/blog.ts's PUBLIC_CSS — change both or a block hidden on a
     funnel page starts showing on a blog post. */
  /* Field label placement + focused state — set per field / per form in the editor.
     DUPLICATED in the other stylesheet (renderPages.ts PAGE_STYLE / lib/blog.ts PUBLIC_CSS);
     change both or a form looks different on a funnel page than on a blog post. */
  .fld { margin:var(--f-gap,6px) 0; }
  .fld > input, .fld > textarea, .fld > select { margin:0; }
  .fld-lbl-above .fld-label { display:block; margin-bottom:4px; font-size:14px; font-weight:600; }
  /* "On border" sits the label across the input's top edge, so it needs the wrapper positioned
     and a background chip to break the border line behind the text. */
  .fld-lbl-border { position:relative; }
  .fld-lbl-border .fld-label { position:absolute; top:-8px; left:10px; padding:0 4px; font-size:12px;
    background:var(--f-bg,var(--t-field-bg,#fff)); color:inherit; }
  .aos-form input:focus, .aos-form textarea:focus, .aos-form select:focus,
  .optin input:focus, .optin textarea:focus, .optin select:focus {
    border-color:var(--f-focus-bc,var(--f-bc,var(--t-field-border,#ccc)));
    background:var(--f-focus-bg,var(--f-bg,var(--t-field-bg,#fff)));
    outline:none;
  }
  @media (max-width:639px) { .hide-mobile { display:none !important; } }
  @media (min-width:640px) and (max-width:1023px) { .hide-tablet { display:none !important; } }
  @media (min-width:1024px) { .hide-desktop { display:none !important; } }
  .countdown { margin:24px 0; text-align:center; }
  .countdown .cd-label { font-size:14px; color:#666; margin-bottom:4px; }
  .countdown .cd-clock { font-size:34px; font-weight:700; font-variant-numeric:tabular-nums; letter-spacing:1px; }
  .countdown .cd-expired { font-size:16px; font-weight:600; }
  /* Deliberately almost nothing: this wrapper holds markup the app didn't write, so every rule
     here is one the pasted code has to fight. Just the vertical rhythm the other blocks have, and
     a guard so an oversized embed widens the page instead of overflowing it sideways. */
  .custom-html { margin:24px 0; max-width:100%; }
  .custom-html img, .custom-html iframe { max-width:100%; }
  .aos-consent { position:fixed; left:0; right:0; bottom:0; z-index:2147483000; display:flex; flex-wrap:wrap; align-items:center; justify-content:center; gap:12px 20px; padding:14px 20px; background:#1a1a1a; color:#f5f5f5; font-size:14px; line-height:1.5; box-shadow:0 -2px 12px rgba(0,0,0,.2); }
  .aos-consent p { margin:0; max-width:60ch; }
  .aos-consent a { color:#9ae6b4; }
  .aos-consent-actions { display:flex; gap:8px; flex-shrink:0; }
  .aos-consent button { cursor:pointer; border:1px solid #555; background:transparent; color:#f5f5f5; padding:8px 16px; border-radius:6px; font-size:14px; font-family:inherit; }
  /* Accept is emphasised but Decline is a real, equally-reachable button — a greyed-out or
     hidden reject is the dark pattern regulators single out. */
  .aos-consent .aos-consent-yes { background:var(--t-primary,#16a34a); border-color:var(--t-primary,#16a34a); font-weight:600; }
  .aos-form-wrap { margin:24px 0; }
  .aos-form { background:var(--t-surface,#fff); border:1px solid var(--t-border,#e5e5e5); border-radius:12px; padding:20px; max-width:460px; margin:0 auto; }
  .aos-form h3 { margin:0 0 10px; font-size:18px; }
  .aos-form input, .aos-form textarea, .aos-form select { width:100%; box-sizing:border-box; padding:var(--t-field-pad,12px); margin:var(--f-gap,6px) 0; border:var(--f-bw,1px) solid var(--f-bc,var(--t-field-border,#ccc)); border-radius:var(--f-br,var(--t-field-radius,8px)); background:var(--f-bg,var(--t-field-bg,#fff)); color:var(--f-fg,inherit); font-size:16px; font-family:inherit; }
  .aos-form .fld-half, .optin .fld-half { width:calc(50% - 5px); display:inline-block; vertical-align:top; }
  .aos-form .fld-half + .fld-half, .optin .fld-half + .fld-half { margin-left:8px; }
  .aos-form .consent-note { font-size:11px; color:var(--t-muted,#888); margin:8px 0; }
  .aos-form-done { font-weight:600; text-align:center; }
  /* A popup form is hidden until a button's popup action shows it. */
  .aos-form-popup { position:fixed; inset:0; z-index:2147482000; display:none; align-items:center; justify-content:center; background:rgba(0,0,0,.5); padding:20px; }
  .aos-form-popup.is-open { display:flex; }
  .aos-form-popup .aos-form { position:relative; width:100%; }
  .aos-form-close { position:absolute; top:8px; right:10px; border:0; background:none; font-size:24px; line-height:1; cursor:pointer; color:var(--t-muted,#888); }
  /* Progress bar, nav bar and standalone icon. DUPLICATED in the other stylesheet; change both. */
  .progress-block { margin:0 0 18px; }
  .progress-label { display:flex; justify-content:space-between; gap:12px; font-size:14px; font-weight:600; margin-bottom:6px; }
  .progress-track { height:10px; border-radius:999px; background:var(--t-field-border,#e5e5e5); overflow:hidden; }
  .progress-fill { height:100%; border-radius:999px; background:var(--t-primary,#16a34a); }
  .progress-caption { margin:6px 0 0; font-size:13px; opacity:.75; }
  .page-nav { margin:0 0 20px; padding:10px 0; border-bottom:1px solid var(--t-field-border,#e5e5e5); background:inherit; }
  .page-nav.is-sticky { position:sticky; top:0; z-index:20; }
  .page-nav-inner { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:12px; }
  .page-nav-brand { font-weight:700; font-size:17px; }
  .page-nav-logo { max-height:36px; width:auto; display:block; }
  .page-nav-links { display:flex; flex-wrap:wrap; align-items:center; gap:18px; }
  .page-nav-links a, .page-nav-links button { color:inherit; font:inherit; font-size:15px; text-decoration:none;
    background:none; border:0; padding:0; cursor:pointer; }
  .page-nav-links a:hover, .page-nav-links button:hover { text-decoration:underline; }
  .icon-block { display:flex; align-items:center; gap:10px; margin:0 0 16px; color:var(--t-primary,#16a34a); }
  .icon-block span { color:var(--t-text,#1a1a1a); font-size:15px; }
  /* Page footer block. DUPLICATED in the other stylesheet; change both. */
  .page-footer { margin-top:32px; padding-top:16px; border-top:1px solid var(--t-field-border,#e5e5e5);
    font-size:13px; color:#666; text-align:center; }
  .page-footer p { margin:0 0 6px; }
  .page-footer-links { display:flex; flex-wrap:wrap; gap:14px; justify-content:center; }
  .page-footer-links a { color:inherit; text-decoration:underline; }
  /* Accordion. Native <details>, so no script — see the faq_item case in blockTree.ts.
     DUPLICATED in the other stylesheet; change both. */
  .faq-item { margin-bottom:10px; border:1px solid var(--t-field-border,#e5e5e5); border-radius:8px; }
  .faq-item > summary { font-size:16px; font-weight:600; padding:12px 14px; cursor:pointer;
    list-style:none; display:flex; align-items:center; justify-content:space-between; gap:12px; }
  .faq-item > summary::-webkit-details-marker { display:none; }
  /* A chevron built from a rotated border, so there is no icon font or inline SVG to ship. */
  .faq-item > summary::after { content:""; width:8px; height:8px; flex:0 0 auto;
    border-right:2px solid currentColor; border-bottom:2px solid currentColor;
    transform:rotate(45deg) translateY(-2px); transition:transform .15s ease; opacity:.55; }
  .faq-item[open] > summary::after { transform:rotate(-135deg) translateY(-2px); }
  .faq-item > p { margin:0; padding:0 14px 12px; }
  .row { display:flex; gap:24px; flex-wrap:wrap; }
  .row .col { flex:1; min-width:200px; }
  .icon-list-item, .image-list-item { display:flex; align-items:center; gap:12px; margin-bottom:12px; }
  .icon-list-item svg { flex-shrink:0; }
  .image-list-item img { width:48px; height:48px; object-fit:cover; border-radius:8px; flex-shrink:0; }
  .block-btn { display:inline-block; background:var(--t-btn-bg,#16a34a); color:var(--t-btn-fg,#fff); border:var(--t-btn-border,none); padding:var(--t-btn-py,12px) var(--t-btn-px,24px); border-radius:var(--t-btn-radius,8px); font-weight:var(--t-btn-weight,600); text-decoration:none; }
  .optin { max-width: 420px; margin: 40px auto 0; padding: 24px; background:var(--t-surface,#fff); border:1px solid var(--t-border,#e5e5e5); border-radius:12px; text-align:center; }
  .optin input, .optin textarea, .optin select { width:100%; box-sizing:border-box; padding:var(--t-field-pad,14px); margin:var(--f-gap,8px) 0; border:var(--f-bw,1px) solid var(--f-bc,var(--t-field-border,#ccc)); border-radius:var(--f-br,var(--t-field-radius,8px)); background:var(--f-bg,var(--t-field-bg,#fff)); color:var(--f-fg,inherit); font-size:16px; font-family:inherit; }
  .optin textarea { resize:vertical; min-height:96px; }
  /* Tick-boxes and radios sit inline with their label, so they must opt out of the full-width
     rule above rather than stretching across the form. */
  .optin .field-check { display:flex; align-items:center; gap:8px; margin:8px 0; font-size:15px; text-align:left; }
  .optin .field-check input { width:auto; margin:0; padding:0; flex-shrink:0; }
  .optin .field-group { border:1px solid var(--t-field-border,#ccc); border-radius:var(--t-field-radius,8px); padding:10px 14px; margin:8px 0; text-align:left; }
  .optin .field-group legend { font-size:14px; color:#555; padding:0 4px; }
  .cta { display:inline-block; background:var(--t-btn-bg,#16a34a); color:var(--t-btn-fg,#fff); border:var(--t-btn-border,none); padding:var(--t-btn-py,16px) var(--t-btn-px,32px); border-radius:var(--t-btn-radius,8px); font-weight:var(--t-btn-weight,600); font-size:var(--t-btn-size,18px); margin-top: 12px; cursor:pointer; width:100%; text-decoration:none; box-sizing:border-box; }
  .cta:hover { background:var(--t-btn-bg-hover,#15803d); color:var(--t-btn-fg-hover,#fff); }
  .hidden { display:none; }
  .reveal { max-width: 420px; margin: 40px auto 0; text-align:center; }
  .decline-wrap { text-align:center; margin-top:16px; }
  .decline { color:var(--t-muted,#888); text-decoration:underline; font-size:14px; }
  .disclosure { margin-top: 48px; padding-top: 24px; border-top: 1px solid #e5e5e5; font-size: 12px; color: #888; }
  .optin .disclosure { margin-top: 12px; padding-top: 0; border-top: none; text-align: left; }

  /* ==========================================================================================
     The funnel page's own look. EVERY selector below is scoped under .wrap, which only funnel
     pages emit — blog posts use <main> and share almost every block class through PUBLIC_CSS
     (.block-btn, .testimonial, .carousel, .optin…), so an unscoped rule here would silently
     restyle the blog too. That is the one hard constraint in this block; keep the .wrap prefix.

     None of this touches a published page. HTML is rendered and stored at write time, so a live
     funnel keeps the stylesheet it was built with until it is rebuilt or re-saved.

     Colour comes from --t-primary-rgb (see pageTheme.ts), which is derived from the product's own
     sales page — so two products produce visibly different pages rather than the same white sheet.
     ========================================================================================== */

  /* A soft wash of the brand colour behind the top of the page. Fixed height and -1 z-index so it
     sits behind content without affecting layout or catching clicks. */
  .wrap { position:relative; }
  .wrap::before {
    content:""; position:absolute; top:0; left:50%; transform:translateX(-50%);
    width:100vw; height:min(520px, 60vh); z-index:-1; pointer-events:none;
    background:
      radial-gradient(60% 70% at 50% 0%, rgba(var(--t-primary-rgb,22,163,74), .13), transparent 70%),
      linear-gradient(to bottom, rgba(var(--t-primary-rgb,22,163,74), .05), transparent);
  }

  /* Type scale that responds to the viewport instead of one fixed size. clamp() keeps the themed
     --t-h1-size as the upper bound, so a tenant raising it in the editor still wins. */
  .wrap h1 { font-size:clamp(30px, 5.2vw, var(--t-h1-size,32px)); letter-spacing:-0.022em; margin-top:0; }
  .wrap h2 { font-size:clamp(21px, 3.2vw, var(--t-h2-size,22px)); letter-spacing:-0.012em; }
  .wrap .section { margin:0 0 8px; }
  .wrap .section + .section { margin-top:12px; }

  /* Images get depth rather than sitting flat on the page. */
  .wrap .block-img { box-shadow:0 12px 32px -12px rgba(0,0,0,.28); }

  /* Buttons: a subtle vertical gradient, a shadow tinted with the brand hue, and a press. */
  .wrap .cta, .wrap .block-btn {
    background-image:linear-gradient(to bottom, rgba(255,255,255,.14), rgba(0,0,0,.06));
    box-shadow:0 8px 20px -8px rgba(var(--t-primary-rgb,22,163,74), .55);
    /* Colour and shadow only. The lift is MOTION, so it lives behind the reduced-motion query
       below with everything else that moves — a hover that shifts the button under the cursor is
       exactly what someone with that preference set has asked not to have. */
    transition:box-shadow .16s ease, background-color .16s ease;
  }
  .wrap .cta:hover, .wrap .block-btn:hover { box-shadow:0 12px 26px -8px rgba(var(--t-primary-rgb,22,163,74), .68); }
  .wrap .cta:active, .wrap .block-btn:active { box-shadow:0 4px 12px -6px rgba(var(--t-primary-rgb,22,163,74), .5); }

  /* The opt-in box is the thing the page exists for, so it reads as a raised card with a brand
     edge along the top rather than a bordered rectangle. */
  .wrap .optin {
    border-radius:16px;
    box-shadow:0 24px 48px -24px rgba(16,24,40,.28), 0 2px 6px -2px rgba(16,24,40,.08);
    border-top:3px solid var(--t-primary,#16a34a);
    padding:28px 24px;
  }
  .wrap .optin input, .wrap .optin textarea, .wrap .optin select { transition:border-color .15s ease, box-shadow .15s ease; }
  .wrap .optin input:focus, .wrap .optin textarea:focus, .wrap .optin select:focus {
    box-shadow:0 0 0 3px rgba(var(--t-primary-rgb,22,163,74), .18);
  }

  /* Testimonials as cards, matching the opt-in's language. */
  .wrap .testimonial { border-radius:12px; box-shadow:0 10px 24px -18px rgba(16,24,40,.4); }

  /* --- Motion -----------------------------------------------------------------------------
     Two layers, both CSS. The page still ships no JavaScript of its own: a funnel page that
     needed a script to become visible would be a page that renders blank when one fails.

     1. An entrance rise for the first few root blocks, staggered.
     2. A scroll-linked reveal for everything, behind @supports — where the browser lacks
        animation-timeline the rules never apply and content is simply visible, which is the
        right failure direction for a page carrying paid traffic.

     Both are wrapped in prefers-reduced-motion: no-preference. Honouring that is not optional
     here: these pages are shown to whoever clicks the ad, including people for whom motion
     causes real symptoms. */
  @media (prefers-reduced-motion: no-preference) {
    @keyframes aos-rise { from { opacity:0; transform:translateY(14px); } to { opacity:1; transform:none; } }

    /* The button's lift, kept with the rest of the motion. */
    .wrap .cta, .wrap .block-btn { transition:transform .16s ease, box-shadow .16s ease, background-color .16s ease; }
    .wrap .cta:hover, .wrap .block-btn:hover { transform:translateY(-1px); }
    .wrap .cta:active, .wrap .block-btn:active { transform:translateY(1px); }

    .wrap > * { animation:aos-rise .5s cubic-bezier(.2,.7,.3,1) both; }
    .wrap > *:nth-child(1) { animation-delay:.02s; }
    .wrap > *:nth-child(2) { animation-delay:.08s; }
    .wrap > *:nth-child(3) { animation-delay:.14s; }
    .wrap > *:nth-child(4) { animation-delay:.20s; }
    .wrap > *:nth-child(n+5) { animation-delay:.24s; }

    /* The scroll-linked layer moves things; it never FADES them, and that is a correctness
       requirement rather than a style choice.

       A scroll-driven animation only advances as far as its element's scroll range allows, and
       elements at the very end of a short document never scroll far enough to finish theirs —
       they freeze partway. With opacity in the keyframes that means permanently invisible, which
       is exactly what happened here: the footer and the AFFILIATE DISCLOSURE both sat at
       opacity 0 at the bottom of the page, and the disclosure is required on every page by
       content rule 3. Caught by scrolling to the bottom and reading back computed opacity.

       Animating transform alone removes the failure mode entirely: the worst a stuck element can
       do is sit a few pixels low, fully visible and readable. The fade still happens — it comes
       from the time-based animation above, which always completes because time always passes. */
    @keyframes aos-slide { from { transform:translateY(14px); } to { transform:none; } }

    @supports (animation-timeline: view()) {
      .wrap > * {
        animation:aos-slide .6s cubic-bezier(.2,.7,.3,1) both;
        animation-delay:0s;
        animation-timeline:view();
        animation-range:entry 0% entry 55%;
      }
    }
  }
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
  nextStepUrl?: string | null,
  tracking?: TrackingSettings | null,
  seo?: SeoMeta | null,
  /**
   * Every step of this funnel, so a form's `branch` action can route one answer to step 3 while
   * another goes to the offer. `nextStepUrl` above is only the first step.
   *
   * Optional because most callers have no funnel steps to describe (the build pipeline, the blog,
   * and the editors' live preview). Absent simply means a `{kind:"step"}` rule resolves to nothing
   * and falls back to its `otherwise` — never a dead link.
   */
  steps?: { id: string; url: string }[]
): string {
  const tree = normalizePageCopy(copy, imageDataUrl, { siteName: product.product_title });
  const ctx: RenderCtx = {
    pageKind: "bridge",
    disclosureText: DISCLOSURE,
    leadConsentText: LEAD_CONSENT_TEXT,
    campaignId,
    primaryHref: hoplink,
    nextStepUrl: nextStepUrl ?? null,
    steps,
    productTitle: product.product_title,
  };
  const meta = seoMetaTags(seo, titleOf(tree));
  const body = renderBlockTree(tree, ctx);
  const t = renderTrackingHtml(tracking);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(meta.title)}</title>
${meta.head}
${t.head}
<style>:root{--content-w:${contentWidthOf(tree)}px;${themeToCssVars((tree as any).theme)}}${PAGE_STYLE}</style>
</head>
<body>
${t.bodyStart}
  <div class="wrap">
    ${body}
  </div>
  <script>
    document.getElementById('leadForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var form = e.target;
      var payload = { campaign_id: form.dataset.campaignId, first_name: '', email: '', extra_fields: {} };
      Array.prototype.forEach.call(form.querySelectorAll('[name]'), function (el) {
        // Checkboxes and radios only count when chosen: an unticked box must send nothing, and a
        // radio group must send the selected option rather than whichever member is last in the
        // DOM. Reading .value blindly (as this did before tick-boxes existed) got both wrong.
        if (el.type === 'checkbox' || el.type === 'radio') {
          if (!el.checked) return;
        }
        if (el.name === 'first_name') payload.first_name = el.value;
        else if (el.name === 'email') payload.email = el.value;
        else if (el.name) payload.extra_fields[el.name] = el.value;
      });
      // Meta Pixel Lead event — only fires when the funnel's tracking settings installed the
      // pixel (window.fbq exists); a harmless no-op check otherwise.
      if (window.fbq) { try { window.fbq('track', 'Lead'); } catch (err) {} }
      // Where the lead goes next is the FORM's setting now (data-after, written by
      // afterSubmitAttrs) rather than a separate reveal-then-click CTA block. "url" is already
      // resolved and validated server-side — the funnel's next step when it has one, else the
      // offer link, else whatever the tenant typed; this script never builds a destination.
      // Anything unrecognised falls through to the in-place thank-you, so submitting always does
      // something visible. A page saved before this shipped still carries #step2, so that reveal
      // is kept as the last fallback.
      function advance() {
        var after = form.getAttribute('data-after');
        if (after === 'url') {
          var u = form.getAttribute('data-after-url');
          if (u) { window.location.href = u; return; }
        }
        // Answer-based routing. Every candidate URL was resolved server-side by afterSubmitAttrs/
        // branchRulesHtml — aosBranchUrl only picks between finished strings, exactly as the 'url'
        // branch above does. No match falls through to the same in-place thank-you as everything else.
        // aosBranchUrl is only defined when this page actually has a branching form (see the
        // conditional emit at the end of this script), so guard rather than assume — an
        // undefined-function throw here would abort advance() and strand the visitor on the form
        // after their lead had already been saved.
        if (after === 'branch' && window.aosBranchUrl) {
          var b = window.aosBranchUrl(form);
          if (b) { window.location.href = b; return; }
        }
        if (after === 'popup') {
          var p = document.getElementById(form.getAttribute('data-after-id') || '');
          if (p) { p.hidden = false; p.classList.add('is-open'); }
        }
        if (form.dataset.nextStepUrl) { window.location.href = form.dataset.nextStepUrl; return; }
        form.style.display = 'none';
        var msg = form.parentElement ? form.parentElement.querySelector('.aos-form-done') : null;
        if (msg) msg.hidden = false;
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
    ${body.includes('data-after="branch"') ? BRANCH_RESOLVE_JS : ""}
  </script>
</body>
</html>`;
}

export type SeoMeta = { seo_title?: string | null; seo_description?: string | null };

// Per-page SEO overrides (0032_seo_meta.sql). Funnel pages stay noindex regardless — these only
// control how the page presents when a tenant shares the URL directly (title, social preview).
// Every value is escapeHtml'd; empty falls back to the page's own first heading.
export function seoMetaTags(seo: SeoMeta | null | undefined, fallbackTitle: string): { title: string; head: string } {
  const title = (seo?.seo_title || "").trim() || fallbackTitle;
  const description = (seo?.seo_description || "").trim();
  const head = [
    description ? `<meta name="description" content="${escapeHtml(description)}" />` : "",
    `<meta property="og:title" content="${escapeHtml(title)}" />`,
    description ? `<meta property="og:description" content="${escapeHtml(description)}" />` : "",
    `<meta name="twitter:card" content="summary" />`,
  ]
    .filter(Boolean)
    .join("\n");
  return { title, head };
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
  declineHref?: string | null,
  tracking?: TrackingSettings | null,
  seo?: SeoMeta | null,
  /** See renderBridgeHtml — a step page can carry a branching form too. */
  steps?: { id: string; url: string }[]
): string {
  const tree = normalizePageCopy(copy, imageDataUrl, { stepType, siteName: product.product_title });
  const ctx: RenderCtx = {
    pageKind: "funnel_step",
    stepType,
    disclosureText: DISCLOSURE,
    leadConsentText: LEAD_CONSENT_TEXT,
    campaignId: "",
    primaryHref,
    declineHref: declineHref ?? null,
    steps,
    productTitle: product.product_title,
  };
  const meta = seoMetaTags(seo, titleOf(tree));
  const body = renderBlockTree(tree, ctx);
  const t = renderTrackingHtml(tracking);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(meta.title)}</title>
${meta.head}
${t.head}
<style>:root{--content-w:${contentWidthOf(tree)}px;${themeToCssVars((tree as any).theme)}}${PAGE_STYLE}
  .cta-wrap { max-width: 420px; margin: 40px auto 0; text-align:center; }
</style>
</head>
<body>
${t.bodyStart}
  <div class="wrap">
    <div class="cta-wrap">
      ${body}
    </div>
  </div>
</body>
</html>`;
}
