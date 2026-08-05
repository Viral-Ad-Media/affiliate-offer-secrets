import { embedUrl, type VideoSource } from "./videoEmbed";
import type { PageTheme } from "./pageTheme";

// The freeform block-tree page model (Phase O) — sections/rows/columns/elements, each stylable.
// Isomorphic, no server-only imports (same discipline as renderPages.ts, which re-exports this
// module's public surface so it stays the one stable import path every existing caller already
// uses). Kept in its own file because it's large; renderPages.ts owns the outer HTML document
// shell (doctype/head/style/submit-script) and both PageCopy-shaped functions that build it.

// Defined here (not renderPages.ts) so blockTree.ts has zero dependency on renderPages.ts —
// renderPages.ts imports/re-exports this instead, keeping the dependency one-directional even
// though renderPages.ts otherwise depends heavily on this module.
export function escapeHtml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ---------------------------------------------------------------------------------------------
// Style
// ---------------------------------------------------------------------------------------------

// Structured values ONLY — never a raw CSS string. This is what makes "full custom styling"
// safe: there is no code path from a BlockStyle to a rendered style="..." attribute that
// concatenates attacker-influenceable text. Every value here is small, typed, and range-checked
// by validatePageBlockTree.ts before it's ever stored; styleToInlineCss() below re-checks the
// same constraints defensively (belt-and-suspenders, matching this codebase's habit of not
// trusting a single validation layer for anything rendered into real HTML served to real
// visitors — see the hoplink XSS fix and image_data_url's anchored regex for the same pattern).
export type HexColor = string; // must match /^#[0-9a-f]{6}$/i
export type FontFamily = "system" | "serif" | "mono";

export const FONT_STACKS: Record<FontFamily, string> = {
  system: '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  mono: '"SF Mono", Consolas, monospace',
};

export type BlockStyle = {
  fontFamily?: FontFamily;
  fontSize?: number; // px, 8-96
  fontWeight?: 400 | 500 | 600 | 700 | 800;
  textAlign?: "left" | "center" | "right";
  color?: HexColor;
  lineHeight?: number; // 1.0-2.5
  backgroundColor?: HexColor;
  paddingTop?: number; // px, 0-200
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  marginTop?: number; // px, 0-200
  marginBottom?: number;
  borderWidth?: number; // px, 0-16
  borderColor?: HexColor;
  borderRadius?: number; // px, 0-64
  maxWidth?: number; // px, 100-1200 — section/row only, ignored elsewhere
};

const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;
const FONT_WEIGHTS = new Set([400, 500, 600, 700, 800]);
const TEXT_ALIGNS = new Set(["left", "center", "right"]);

// The single choke point every BlockStyle value passes through on its way into HTML. Per-key,
// not a generic loop over arbitrary props — a key not explicitly handled here can never emit
// anything, regardless of what's in `allowed` or the stored object.
export function styleToInlineCss(style: BlockStyle | undefined, allowed: readonly (keyof BlockStyle)[]): string {
  if (!style) return "";
  const parts: string[] = [];
  const has = (k: keyof BlockStyle) => allowed.includes(k);
  const px = (n: unknown, min: number, max: number) =>
    typeof n === "number" && Number.isFinite(n) && n >= min && n <= max ? Math.round(n) : null;
  const hex = (v: unknown) => (typeof v === "string" && HEX_COLOR_RE.test(v) ? v.toLowerCase() : null);

  if (has("fontFamily") && style.fontFamily && FONT_STACKS[style.fontFamily]) {
    parts.push(`font-family:${FONT_STACKS[style.fontFamily]}`);
  }
  if (has("fontSize")) {
    const v = px(style.fontSize, 8, 96);
    if (v !== null) parts.push(`font-size:${v}px`);
  }
  if (has("fontWeight") && typeof style.fontWeight === "number" && FONT_WEIGHTS.has(style.fontWeight)) {
    parts.push(`font-weight:${style.fontWeight}`);
  }
  if (has("textAlign") && typeof style.textAlign === "string" && TEXT_ALIGNS.has(style.textAlign)) {
    parts.push(`text-align:${style.textAlign}`);
  }
  if (has("color")) {
    const v = hex(style.color);
    if (v) parts.push(`color:${v}`);
  }
  if (has("lineHeight")) {
    const n = style.lineHeight;
    if (typeof n === "number" && Number.isFinite(n) && n >= 1 && n <= 2.5) parts.push(`line-height:${n}`);
  }
  if (has("backgroundColor")) {
    const v = hex(style.backgroundColor);
    if (v) parts.push(`background-color:${v}`);
  }
  for (const [key, prop] of [
    ["paddingTop", "padding-top"],
    ["paddingRight", "padding-right"],
    ["paddingBottom", "padding-bottom"],
    ["paddingLeft", "padding-left"],
    ["marginTop", "margin-top"],
    ["marginBottom", "margin-bottom"],
  ] as const) {
    if (has(key)) {
      const v = px(style[key], 0, 200);
      if (v !== null) parts.push(`${prop}:${v}px`);
    }
  }
  if (has("borderWidth")) {
    const v = px(style.borderWidth, 0, 16);
    if (v !== null && v > 0) {
      parts.push(`border-width:${v}px`, "border-style:solid");
      const bc = has("borderColor") ? hex(style.borderColor) : null;
      parts.push(`border-color:${bc ?? "#000000"}`);
    }
  }
  if (has("borderRadius")) {
    const v = px(style.borderRadius, 0, 64);
    if (v !== null) parts.push(`border-radius:${v}px`);
  }
  if (has("maxWidth")) {
    const v = px(style.maxWidth, 100, 1200);
    if (v !== null) parts.push(`max-width:${v}px`);
  }
  return parts.join(";");
}

function styleAttr(style: BlockStyle | undefined, allowed: readonly (keyof BlockStyle)[]): string {
  const css = styleToInlineCss(style, allowed);
  return css ? ` style="${css}"` : "";
}

// ---------------------------------------------------------------------------------------------
// Block types
// ---------------------------------------------------------------------------------------------

type Base = { id: string; style: BlockStyle };

export type HeadingBlock = Base & { type: "heading"; content: { text: string } };
export type SubheadingBlock = Base & { type: "subheading"; content: { text: string } };
export type ParagraphBlock = Base & { type: "paragraph"; content: { text: string } };
export type ImageBlock = Base & { type: "image"; content: { dataUrl: string | null; alt: string } };
export type BulletListBlock = Base & { type: "bullet_list"; content: { items: string[] } };
export type IconListBlock = Base & { type: "icon_list"; content: { items: { icon: string; text: string }[] } };
export type DividerBlock = Base & { type: "divider"; content: Record<string, never> };
export type ImageListBlock = Base & {
  type: "image_list";
  content: { items: { imageDataUrl: string | null; caption: string }[] };
};
export type ButtonBlock = Base & { type: "button"; content: { text: string; href: string } };
// The source is a parsed provider + id, never the raw pasted URL — see lib/engine/videoEmbed.ts
// for why the renderer must rebuild the embed URL rather than interpolate what someone typed.
export type VideoBlock = Base & {
  type: "video";
  content: { source: VideoSource | null; title: string };
};
export type FaqItemBlock = Base & { type: "faq_item"; content: { question: string; answer: string } };

// One testimonial, in one of three media shapes. `media` is what varies; quote/name/role are
// shared, because an attributed name is the part that makes a testimonial a testimonial — a
// floating quote with nobody behind it is just a pull-quote.
//
// The video variant reuses VideoSource (a PARSED {provider, videoId}), not a URL string, for
// exactly the reason the video block does: the renderer rebuilds the embed URL from a fixed
// template, so no tenant-typed string ever reaches an iframe src. Adding a second place that
// accepts a raw URL would reopen that hole in the one block type most likely to be pasted into.
export type TestimonialMedia =
  | { kind: "text" }
  | { kind: "image"; dataUrl: string | null }
  | { kind: "video"; source: VideoSource | null };

export type TestimonialBlock = Base & {
  type: "testimonial";
  content: { quote: string; name: string; role: string; media: TestimonialMedia };
};

export const TESTIMONIAL_MEDIA_KINDS = ["text", "image", "video"] as const;

export type ElementBlock =
  | HeadingBlock
  | SubheadingBlock
  | ParagraphBlock
  | ImageBlock
  | BulletListBlock
  | IconListBlock
  | DividerBlock
  | ImageListBlock
  | ButtonBlock
  | VideoBlock
  | FaqItemBlock
  | TestimonialBlock;

export const ELEMENT_BLOCK_TYPES = [
  "heading",
  "subheading",
  "paragraph",
  "image",
  "bullet_list",
  "icon_list",
  "divider",
  "image_list",
  "button",
  "video",
  "faq_item",
  "testimonial",
] as const;

// Only ever a child of a lead_capture_form block — never part of ElementBlock, so a Column's
// children (typed ElementBlock[]) can never structurally contain one. A "floating" form input
// elsewhere on the page is impossible by construction, not just rejected at validation time.
// Field types a tenant can drag into the lead-capture form. Kept as one exported list so the
// schema, the validator, the renderer and the editor's dropdown can never disagree about what's
// legal — adding a type here is the only place a new one has to be declared.
export const FORM_FIELD_TYPES = [
  "text",
  "email",
  "tel",
  "number",
  "url",
  "textarea",
  "checkbox",
  "radio",
  "select",
] as const;
export type FormFieldType = (typeof FORM_FIELD_TYPES)[number];

// Types whose whole point is a fixed set of answers — meaningless without options, so the
// validator requires at least one and the editor seeds two.
export const CHOICE_FIELD_TYPES: readonly FormFieldType[] = ["radio", "select"];

export type FormInputBlock = Base & {
  type: "form_input";
  content: {
    label: string;
    fieldKey: string;
    fieldType: FormFieldType;
    placeholder: string;
    required: boolean;
    /** radio/select only. Ignored for every other type. */
    options?: string[];
  };
};

export type ColumnBlock = Base & { type: "column"; children: ElementBlock[] };
export type RowBlock = Base & { type: "row"; layout: "1col" | "2col" | "3col"; columns: ColumnBlock[] };
export type SectionBlock = Base & { type: "section"; children: (RowBlock | ElementBlock)[] };

// Locked (compliance-critical) blocks — a strict 1:1 type<->locked mapping enforced by
// validatePageBlockTree.ts. Draggable to reposition among root-level siblings; never deletable;
// core content/wiring never editable. See CLAUDE.md's "Freeform block page builder" section for
// the full design rationale.
export type DisclosureBlock = Base & { type: "disclosure"; locked: "disclosure"; content: Record<string, never> };
// The fixed name/email inputs are NOT tree nodes — renderBlockTree's lead_capture_form case
// always renders them first, unconditionally. There is no tree state that could represent
// "email field deleted."
export type LeadCaptureFormBlock = Base & {
  type: "lead_capture_form";
  locked: "lead_capture_form";
  content: { ctaText: string };
  children: FormInputBlock[];
};
export type PrimaryCtaBlock = Base & { type: "primary_cta"; locked: "primary_cta"; content: { text: string } };
// 4th locked kind (beyond the 3 named originally) — funnel-step upsell's "No thanks, continue"
// link, same locked-href/editable-text/style shape as primary_cta.
export type DeclineLinkBlock = Base & { type: "decline_link"; locked: "decline_link"; content: { text: string } };

export type LockedBlock = DisclosureBlock | LeadCaptureFormBlock | PrimaryCtaBlock | DeclineLinkBlock;

export type Block = SectionBlock | RowBlock | ColumnBlock | ElementBlock | FormInputBlock | LockedBlock;
export type BlockType = Block["type"];

export type PageBlockTree = {
  version: 2;
  blocks: (SectionBlock | LockedBlock)[];
  /** Max width of the page's content column, in px. See contentWidthOf() below. */
  contentWidth?: number;
  /** Palette / typography / button / form styling. See lib/engine/pageTheme.ts. */
  theme?: PageTheme;
};

// The content column is `width:90%; max-width:<contentWidth>px` — a percentage so narrow screens
// get a gutter without a media query, and a px cap so a wide monitor doesn't stretch a line of
// text to 2000px. Stored on the TREE rather than on campaigns/blog_posts because page_copy is the
// one thing every page kind already has: funnel opt-in, split-test variants, funnel steps and blog
// posts all get this from one field with no migration.
export const DEFAULT_CONTENT_WIDTH = 1280;
export const MIN_CONTENT_WIDTH = 480;
export const MAX_CONTENT_WIDTH = 1600;

/** Reads a stored width off any page_copy shape, clamped. Legacy/absent → the default. */
export function contentWidthOf(raw: unknown): number {
  const n = (raw as { contentWidth?: unknown } | null)?.contentWidth;
  if (typeof n !== "number" || !Number.isFinite(n)) return DEFAULT_CONTENT_WIDTH;
  return Math.min(MAX_CONTENT_WIDTH, Math.max(MIN_CONTENT_WIDTH, Math.round(n)));
}

// ---------------------------------------------------------------------------------------------
// Icons — a curated, bounded set (not the full lucide-react catalog). Rendering happens as a
// plain string (renderPages.ts is a pure isomorphic string-builder, no react-dom/server), so
// icons are hand-authored inline SVG rather than rendered lucide-react components. This map is
// ALSO validatePageBlockTree.ts's ALLOWED_ICON_NAMES source — a stored icon_list item's `icon`
// value that isn't a key here is never rendered (falls back to a plain bullet), closing off any
// use of user input as a lookup key into something that could execute or fetch.
// ---------------------------------------------------------------------------------------------

export const ICON_SVG_PATHS: Record<string, string> = {
  check: '<polyline points="20 6 9 17 4 12" />',
  "check-circle": '<circle cx="12" cy="12" r="10" /><polyline points="16 9 10.5 15 8 12.5" />',
  star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />',
  heart:
    '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z" />',
  shield: '<path d="M12 2 4 5v6c0 5 3.5 9 8 11 4.5-2 8-6 8-11V5z" />',
  clock: '<circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />',
  zap: '<polygon points="13 2 3 14 11 14 11 22 21 10 13 10 13 2" />',
  award: '<circle cx="12" cy="8" r="6" /><path d="M8.2 13.4 7 22l5-3 5 3-1.2-8.6" />',
  "thumbs-up": '<path d="M7 22V11h3l4-8 2 1v6h5l-2 12H7z" />',
  sparkles: '<path d="M12 2v6M12 16v6M4 12h6M14 12h6M6 6l3 3M15 15l3 3M18 6l-3 3M9 15l-3 3" />',
  target: '<circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1" />',
  "trending-up": '<polyline points="3 17 9 11 13 15 21 6" /><polyline points="15 6 21 6 21 12" />',
  users: '<circle cx="9" cy="8" r="3.5" /><path d="M2 20c0-3.9 3.1-7 7-7s7 3.1 7 7" /><path d="M17 6a3.5 3.5 0 0 1 0 7" /><path d="M22 20c0-3-2-5.5-4.7-6.5" />',
  gift: '<rect x="3" y="8" width="18" height="13" /><path d="M12 8v13M3 12h18" /><path d="M12 8C10 8 8 6.5 8 4.5S9.5 2 11 3s1 5 1 5zM12 8c2 0 4-1.5 4-3.5S14.5 2 13 3s-1 5-1 5z" />',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" />',
  mail: '<rect x="2" y="4" width="20" height="16" rx="2" /><polyline points="2 6 12 13 22 6" />',
  phone: '<path d="M6 3h4l2 5-2.5 1.5a11 11 0 0 0 5 5L16 12l5 2v4a2 2 0 0 1-2 2C10 20 3 13 3 5a2 2 0 0 1 2-2z" />',
  "map-pin": '<path d="M12 22s7-6.6 7-12a7 7 0 1 0-14 0c0 5.4 7 12 7 12z" /><circle cx="12" cy="10" r="2.5" />',
  calendar: '<rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 9h18M8 2v4M16 2v4" />',
  "dollar-sign": '<path d="M12 2v20" /><path d="M17 6.5c0-1.9-2.2-3-5-3s-5 1.1-5 3 2.2 3 5 3 5 1.1 5 3-2.2 3-5 3-5-1.1-5-3" />',
  package: '<path d="M3 8l9-5 9 5-9 5-9-5z" /><path d="M3 8v8l9 5 9-5V8" /><path d="M12 13v8" />',
  truck: '<rect x="1" y="6" width="14" height="11" /><path d="M15 10h4l3 3v4h-7z" /><circle cx="6" cy="19" r="1.7" /><circle cx="17.5" cy="19" r="1.7" />',
  "refresh-cw": '<path d="M21 12a9 9 0 1 1-3-6.7" /><polyline points="21 3 21 8 16 8" />',
  "alert-circle": '<circle cx="12" cy="12" r="10" /><path d="M12 7v6M12 17h.01" />',
  "x-circle": '<circle cx="12" cy="12" r="10" /><path d="m9 9 6 6M15 9l-6 6" />',
};

export const ALLOWED_ICON_NAMES: string[] = Object.keys(ICON_SVG_PATHS);

function renderIcon(name: string): string {
  const inner = ICON_SVG_PATHS[name];
  if (!inner) return "";
  return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
}

// ---------------------------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------------------------

export type FunnelStepType = "thank_you" | "upsell" | "order";

export type RenderCtx = {
  // "blog" (blog posts, lib/blog.ts) uses only disclosureText/productTitle — its validator
  // profile (validatePageBlockTree.ts) forbids the lead-capture/CTA/decline locked blocks, so
  // the campaign-shaped ctx fields are never read on that path.
  pageKind: "bridge" | "funnel_step" | "blog";
  stepType?: FunnelStepType;
  disclosureText: string;
  leadConsentText: string;
  campaignId: string;
  primaryHref: string;
  declineHref?: string | null;
  nextStepUrl?: string | null;
  productTitle: string;
};

// Inline markdown for paragraph/bullet text: [text](https://url) links and **bold** only.
// Everything is escapeHtml'd FIRST and the tags below are code-built — user text can never open
// a tag itself. Links get rel="sponsored noopener" (these are overwhelmingly affiliate links —
// imported blog articles carry their hoplinks as markdown links, which is why this exists) and
// hrefs must be http(s). Applies everywhere the block tree renders (funnel pages included) —
// additive there, since generated funnel copy never contained markdown link syntax.
const INLINE_LINK_RE = /\[([^\]\n]{1,300})\]\((https?:\/\/[^)\s]{1,600})\)/;

function inlineBold(escaped: string): string {
  return escaped.replace(/\*\*([^*\n]{1,300})\*\*/g, "<strong>$1</strong>");
}

export function renderInline(text: string): string {
  let out = "";
  let rest = text;
  for (let i = 0; i < 100; i++) {
    const m = INLINE_LINK_RE.exec(rest);
    if (!m) break;
    out += inlineBold(escapeHtml(rest.slice(0, m.index)));
    out += `<a href="${escapeHtml(m[2])}" target="_blank" rel="sponsored noopener">${inlineBold(escapeHtml(m[1]))}</a>`;
    rest = rest.slice(m.index + m[0].length);
  }
  return out + inlineBold(escapeHtml(rest));
}

// Exported so components/BlockStylePanel.tsx (Phase O.4) can show exactly the controls that will
// actually take effect for a given block type — a single source of truth shared with the render
// call sites below, instead of the panel re-deriving (and risking drifting from) this mapping.
export const TEXT_STYLE_KEYS = ["fontFamily", "fontSize", "fontWeight", "textAlign", "color", "lineHeight", "marginTop", "marginBottom"] as const;
export const BOX_STYLE_KEYS = [
  "backgroundColor",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "marginTop",
  "marginBottom",
  "borderWidth",
  "borderColor",
  "borderRadius",
  "maxWidth",
] as const;
export const BUTTON_STYLE_KEYS = [
  "fontFamily",
  "fontSize",
  "fontWeight",
  "color",
  "backgroundColor",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "borderWidth",
  "borderColor",
  "borderRadius",
  "marginTop",
  "marginBottom",
] as const;
export const DIVIDER_STYLE_KEYS = ["borderColor", "borderWidth", "marginTop", "marginBottom"] as const;

// form_input has no entry here — it's never independently selectable/stylable in the editor (it
// only ever renders inside the lead-capture form's fixed layout), but every other BlockType needs
// one so this Record stays exhaustive (a missing case is a compile error, not a silent gap).
export const STYLE_KEYS_BY_TYPE: Record<Exclude<BlockType, "form_input">, readonly (keyof BlockStyle)[]> = {
  heading: TEXT_STYLE_KEYS,
  subheading: TEXT_STYLE_KEYS,
  paragraph: TEXT_STYLE_KEYS,
  image: BOX_STYLE_KEYS,
  bullet_list: TEXT_STYLE_KEYS,
  icon_list: TEXT_STYLE_KEYS,
  divider: DIVIDER_STYLE_KEYS,
  image_list: TEXT_STYLE_KEYS,
  testimonial: TEXT_STYLE_KEYS,
  button: BUTTON_STYLE_KEYS,
  video: BOX_STYLE_KEYS,
  faq_item: TEXT_STYLE_KEYS,
  column: BOX_STYLE_KEYS,
  row: BOX_STYLE_KEYS,
  section: BOX_STYLE_KEYS,
  disclosure: TEXT_STYLE_KEYS,
  lead_capture_form: BOX_STYLE_KEYS,
  primary_cta: BUTTON_STYLE_KEYS,
  decline_link: TEXT_STYLE_KEYS,
};

function renderElement(block: ElementBlock, ctx: RenderCtx): string {
  switch (block.type) {
    case "heading":
      return `<h1${styleAttr(block.style, TEXT_STYLE_KEYS)}>${escapeHtml(block.content.text)}</h1>`;
    case "subheading":
      return `<h2${styleAttr(block.style, TEXT_STYLE_KEYS)}>${escapeHtml(block.content.text)}</h2>`;
    case "paragraph":
      return `<p${styleAttr(block.style, TEXT_STYLE_KEYS)}>${renderInline(block.content.text)}</p>`;
    case "image":
      return block.content.dataUrl
        ? `<img src="${escapeHtml(block.content.dataUrl)}" alt="${escapeHtml(block.content.alt || ctx.productTitle)}"${styleAttr(
            block.style,
            BOX_STYLE_KEYS
          )} class="block-img" />`
        : "";
    case "bullet_list":
      return `<ul${styleAttr(block.style, TEXT_STYLE_KEYS)}>${block.content.items
        .map((i) => `<li>${renderInline(i)}</li>`)
        .join("")}</ul>`;
    case "icon_list":
      return `<div class="icon-list"${styleAttr(block.style, TEXT_STYLE_KEYS)}>${block.content.items
        .map(
          (i) =>
            `<div class="icon-list-item">${renderIcon(i.icon)}<span>${escapeHtml(i.text)}</span></div>`
        )
        .join("")}</div>`;
    case "divider":
      return `<hr${styleAttr(block.style, DIVIDER_STYLE_KEYS)} />`;
    case "image_list":
      return `<div class="image-list"${styleAttr(block.style, TEXT_STYLE_KEYS)}>${block.content.items
        .map(
          (i) =>
            `<div class="image-list-item">${
              i.imageDataUrl ? `<img src="${escapeHtml(i.imageDataUrl)}" alt="" />` : ""
            }<span>${escapeHtml(i.caption)}</span></div>`
        )
        .join("")}</div>`;
    case "button":
      return `<a class="block-btn" href="${escapeHtml(block.content.href)}"${styleAttr(
        block.style,
        BUTTON_STYLE_KEYS
      )}>${escapeHtml(block.content.text)}</a>`;
    case "video": {
      const src = block.content.source;
      if (!src) return "";
      const label = escapeHtml(block.content.title || `${ctx.productTitle} video`);
      if (src.provider === "file") {
        return `<div class="video-wrap"${styleAttr(block.style, BOX_STYLE_KEYS)}><video controls playsinline preload="metadata" src="${escapeHtml(
          src.url
        )}" title="${label}"></video></div>`;
      }
      // allow: only what a player legitimately needs. No `allow-same-origin`-style escape hatch,
      // and referrerpolicy keeps the tenant's page URL out of the provider's logs by default.
      return `<div class="video-wrap"${styleAttr(block.style, BOX_STYLE_KEYS)}><iframe src="${escapeHtml(
        embedUrl(src)
      )}" title="${label}" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>`;
    }
    case "faq_item":
      return `<div class="faq-item"${styleAttr(block.style, TEXT_STYLE_KEYS)}><h3>${escapeHtml(
        block.content.question
      )}</h3><p>${escapeHtml(block.content.answer)}</p></div>`;
    case "testimonial": {
      const { quote, name, role, media } = block.content;
      // An empty testimonial renders nothing rather than an attributed-to-nobody quote box — same
      // call as the video block's null source: a half-filled block must not ship to real traffic.
      if (!quote.trim() && !name.trim() && media.kind === "text") return "";

      let mediaHtml = "";
      if (media.kind === "image" && media.dataUrl) {
        mediaHtml = `<div class="tm-media tm-avatar"><img src="${escapeHtml(media.dataUrl)}" alt="${escapeHtml(
          name
        )}" /></div>`;
      } else if (media.kind === "video" && media.source) {
        const label = escapeHtml(name ? `${name} — testimonial` : "Testimonial");
        mediaHtml =
          media.source.provider === "file"
            ? `<div class="tm-media video-wrap"><video controls playsinline preload="metadata" src="${escapeHtml(
                media.source.url
              )}" title="${label}"></video></div>`
            : `<div class="tm-media video-wrap"><iframe src="${escapeHtml(
                embedUrl(media.source)
              )}" title="${label}" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>`;
      }

      // <figure>/<figcaption> because that is what this is: a quotation with an attribution.
      // cite carries the name for anything reading the page structurally.
      const attribution = [
        name.trim() ? `<span class="tm-name">${escapeHtml(name)}</span>` : "",
        role.trim() ? `<span class="tm-role">${escapeHtml(role)}</span>` : "",
      ].join("");
      return `<figure class="testimonial tm-${media.kind}"${styleAttr(block.style, TEXT_STYLE_KEYS)}>${mediaHtml}<blockquote>${escapeHtml(
        quote
      )}</blockquote>${attribution ? `<figcaption>${attribution}</figcaption>` : ""}</figure>`;
    }
  }
}

function renderColumn(col: ColumnBlock, ctx: RenderCtx): string {
  return `<div class="col"${styleAttr(col.style, BOX_STYLE_KEYS)}>${col.children
    .map((c) => renderElement(c, ctx))
    .join("\n")}</div>`;
}

function renderRow(row: RowBlock, ctx: RenderCtx): string {
  return `<div class="row"${styleAttr(row.style, BOX_STYLE_KEYS)}>${row.columns
    .map((c) => renderColumn(c, ctx))
    .join("\n")}</div>`;
}

function renderSection(section: SectionBlock, ctx: RenderCtx): string {
  return `<div class="section"${styleAttr(section.style, BOX_STYLE_KEYS)}>${section.children
    .map((c) => (c.type === "row" ? renderRow(c, ctx) : renderElement(c, ctx)))
    .join("\n")}</div>`;
}

// LEAD_CAPTURE_ENDPOINT: posts to /api/public/leads. The fixed name/email inputs and the POST
// wiring below are rendered by this function only — never exposed as editable fields in the
// editor, so they can't be redirected or removed via the block-tree builder.
// One tenant-added field. Every branch emits a `name` matching the block's fieldKey, because that
// is what the submit handler collects and what the leads route validates against the page's
// current field list — a field rendered without it silently never reaches the database.
function renderFormField(f: FormInputBlock): string {
  const name = escapeHtml(f.content.fieldKey);
  const label = escapeHtml(f.content.label);
  const placeholder = escapeHtml(f.content.placeholder || f.content.label);
  const required = f.content.required ? " required" : "";
  const options = (f.content.options ?? []).filter((o) => o.trim() !== "");

  switch (f.content.fieldType) {
    case "textarea":
      return `<textarea name="${name}" placeholder="${placeholder}" rows="4"${required}></textarea>`;

    case "checkbox":
      // Value is only submitted when ticked, which is exactly the semantics a checkbox should
      // have — an unticked box sends nothing rather than "false".
      return `<label class="field-check"><input type="checkbox" name="${name}" value="yes"${required} /> <span>${label}</span></label>`;

    case "radio": {
      if (options.length === 0) return "";
      const inputs = options
        .map(
          (o, i) =>
            `<label class="field-check"><input type="radio" name="${name}" value="${escapeHtml(o)}"${
              i === 0 ? required : ""
            } /> <span>${escapeHtml(o)}</span></label>`
        )
        .join("");
      // required goes on the FIRST radio only: HTML treats a required radio group as satisfied by
      // any member, and repeating it just makes the browser's own message noisier.
      return `<fieldset class="field-group"><legend>${label}</legend>${inputs}</fieldset>`;
    }

    case "select": {
      if (options.length === 0) return "";
      const opts = options
        .map((o) => `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`)
        .join("");
      // The placeholder option carries no value, so "nothing chosen" fails a required check
      // instead of submitting the prompt text as an answer.
      return `<select name="${name}"${required}><option value="">${placeholder}</option>${opts}</select>`;
    }

    default:
      return `<input name="${name}" type="${f.content.fieldType}" placeholder="${placeholder}"${required} />`;
  }
}

function renderLeadCaptureForm(block: LeadCaptureFormBlock, ctx: RenderCtx): string {
  const extraInputs = block.children.map(renderFormField).filter(Boolean).join("\n          ");
  return `<div class="optin"${styleAttr(block.style, BOX_STYLE_KEYS)}>
        <form id="leadForm" data-campaign-id="${escapeHtml(ctx.campaignId)}" data-next-step-url="${
    ctx.nextStepUrl ? escapeHtml(ctx.nextStepUrl) : ""
  }">
          <input id="leadFirstName" name="first_name" type="text" placeholder="First name" required />
          <input id="leadEmail" name="email" type="email" placeholder="Email address" required />
          ${extraInputs}
          <button type="submit" class="cta">${escapeHtml(block.content.ctaText)}</button>
          <p class="disclosure">${ctx.leadConsentText}</p>
        </form>
      </div>`;
}

function renderLockedBlock(block: LockedBlock, ctx: RenderCtx): string {
  switch (block.locked) {
    case "disclosure":
      return `<p class="disclosure"${styleAttr(block.style, TEXT_STYLE_KEYS)}>${ctx.disclosureText}</p>`;
    case "lead_capture_form":
      return renderLeadCaptureForm(block, ctx);
    case "primary_cta": {
      const inner = `<a class="cta" href="${escapeHtml(ctx.primaryHref)}"${styleAttr(
        block.style,
        BUTTON_STYLE_KEYS
      )}>${escapeHtml(block.content.text)}</a>`;
      return ctx.pageKind === "bridge" ? `<div id="step2" class="hidden reveal">${inner}</div>` : inner;
    }
    case "decline_link":
      if (!(ctx.pageKind === "funnel_step" && ctx.stepType === "upsell" && ctx.declineHref)) return "";
      return `<p class="decline-wrap"><a class="decline" href="${escapeHtml(ctx.declineHref)}"${styleAttr(
        block.style,
        TEXT_STYLE_KEYS
      )}>${escapeHtml(block.content.text)}</a></p>`;
  }
}

// Returns a body-fragment string — renderBridgeHtml/renderFunnelStepHtml in renderPages.ts own
// the outer <!doctype>/<head>/<style>/submit-script and splice this in unchanged.
export function renderBlockTree(tree: PageBlockTree, ctx: RenderCtx): string {
  // The affiliate disclosure always renders LAST, wherever it sits in the block order. It's a
  // footer notice by convention — every network and ad reviewer expects it there — and it was
  // previously draggable to any root position, so a page could legitimately ship with the
  // disclosure above the fold and the offer below it. Hoisting here rather than reordering the
  // stored tree means old pages get the right placement on their next render with no migration,
  // and nothing can drag it back out of place. Content rule 3 says the disclosure is mandatory;
  // this decides where.
  const disclosure = tree.blocks.filter((b) => b.type === "disclosure");
  const rest = tree.blocks.filter((b) => b.type !== "disclosure");
  return [...rest, ...disclosure]
    .map((b) => (b.type === "section" ? renderSection(b, ctx) : renderLockedBlock(b, ctx)))
    .join("\n");
}

// ---------------------------------------------------------------------------------------------
// Client-side tree mutation helpers — pure, used by the editor (components/WysiwygCanvas.tsx and
// friends) to produce a new tree after an edit, so call sites don't hand-roll tree-walking logic.
// NEVER the security boundary (validatePageBlockTree.ts on save is) — these just need to produce
// a plausible tree for the editor to keep working with locally between saves.
// ---------------------------------------------------------------------------------------------

export function newBlockId(): string {
  return `b-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
}

function walkAndUpdate(node: any, blockId: string, fn: (b: any) => any): any {
  if (!node || typeof node !== "object") return node;
  if (node.id === blockId) return fn(node);
  if (Array.isArray(node.children)) {
    return { ...node, children: node.children.map((c: any) => walkAndUpdate(c, blockId, fn)) };
  }
  if (Array.isArray(node.columns)) {
    return { ...node, columns: node.columns.map((c: any) => walkAndUpdate(c, blockId, fn)) };
  }
  return node;
}

function walkAndUpdateChildren(node: any, containerId: string, fn: (children: any[]) => any[]): any {
  if (!node || typeof node !== "object") return node;
  if (node.id === containerId && Array.isArray(node.children)) {
    return { ...node, children: fn(node.children) };
  }
  if (Array.isArray(node.children)) {
    return { ...node, children: node.children.map((c: any) => walkAndUpdateChildren(c, containerId, fn)) };
  }
  if (Array.isArray(node.columns)) {
    return { ...node, columns: node.columns.map((c: any) => walkAndUpdateChildren(c, containerId, fn)) };
  }
  return node;
}

// Shallow-merges `contentPatch` into whichever block matches `blockId`, anywhere in the tree
// (root, inside a section, inside a row's column, or a lead-capture-form's fields).
export function updateBlockContent(tree: PageBlockTree, blockId: string, contentPatch: Record<string, unknown>): PageBlockTree {
  return {
    ...tree,
    blocks: tree.blocks.map((b) => walkAndUpdate(b, blockId, (node) => ({ ...node, content: { ...node.content, ...contentPatch } }))),
  } as PageBlockTree;
}

export function updateBlockStyle(tree: PageBlockTree, blockId: string, stylePatch: BlockStyle): PageBlockTree {
  return {
    ...tree,
    blocks: tree.blocks.map((b) => walkAndUpdate(b, blockId, (node) => ({ ...node, style: { ...node.style, ...stylePatch } }))),
  } as PageBlockTree;
}

// Removes one child block from whichever container has id === parentId (a section's children,
// a column's children, or a lead-capture-form's fields) — used by "remove benefit"/"remove FAQ
// item"/"remove form field" actions. No-op if the parent or child isn't found.
export function removeChildBlock(tree: PageBlockTree, parentId: string, childId: string): PageBlockTree {
  return {
    ...tree,
    blocks: tree.blocks.map((b) =>
      walkAndUpdateChildren(b, parentId, (children) => children.filter((c: any) => c.id !== childId))
    ),
  } as PageBlockTree;
}

// Appends one new child block to whichever container has id === parentId — used by "add
// benefit"/"add FAQ item"/"add form field" actions. Callers build `newChild` with newBlockId().
export function addChildBlock(tree: PageBlockTree, parentId: string, newChild: unknown): PageBlockTree {
  return {
    ...tree,
    blocks: tree.blocks.map((b) => walkAndUpdateChildren(b, parentId, (children) => [...children, newChild])),
  } as PageBlockTree;
}

// ---------------------------------------------------------------------------------------------
// Nested drag-and-drop + Row/Column/element insertion (Phase O.3). A "container" is one of the
// three arrays a block can live in: the tree's own root list, a Section's `children`, or a Row's
// specific Column's `children`. Modeled as multiple independent dnd-kit sortable containers
// (the standard "multiple containers" pattern) rather than one globally-flattened indented list —
// our containment rules are already a fixed, shallow shape (root -> section-child -> column-child,
// 3 levels), so per-container arrays are simpler to reason about and less failure-prone than
// generic indentation-based tree projection, while still letting an element move between any two
// compatible containers (a column and a section, or two different columns). NEVER the security
// boundary — validatePageBlockTree.ts re-checks everything server-side on save; these just need
// to produce a plausible tree for the editor to keep working with locally between saves.
// ---------------------------------------------------------------------------------------------

export type ContainerRef =
  | { kind: "root" }
  | { kind: "section"; sectionId: string }
  | { kind: "column"; rowId: string; colIndex: number };

export function containerKey(ref: ContainerRef): string {
  if (ref.kind === "root") return "root";
  if (ref.kind === "section") return `section:${ref.sectionId}`;
  return `column:${ref.rowId}:${ref.colIndex}`;
}

export function parseContainerKey(key: string): ContainerRef | null {
  if (key === "root") return { kind: "root" };
  if (key.startsWith("section:")) return { kind: "section", sectionId: key.slice("section:".length) };
  const m = key.match(/^column:(.+):(\d+)$/);
  if (m) return { kind: "column", rowId: m[1], colIndex: Number(m[2]) };
  return null;
}

function getContainer(tree: PageBlockTree, ref: ContainerRef): any[] | null {
  if (ref.kind === "root") return tree.blocks;
  if (ref.kind === "section") {
    const s = tree.blocks.find((b) => b.type === "section" && b.id === ref.sectionId) as SectionBlock | undefined;
    return s ? s.children : null;
  }
  for (const b of tree.blocks) {
    if (b.type !== "section") continue;
    for (const c of b.children) {
      if (c.type === "row" && c.id === ref.rowId) return c.columns[ref.colIndex]?.children ?? null;
    }
  }
  return null;
}

function withContainer(tree: PageBlockTree, ref: ContainerRef, items: any[]): PageBlockTree {
  if (ref.kind === "root") return { ...tree, blocks: items } as PageBlockTree;
  if (ref.kind === "section") {
    return {
      ...tree,
      blocks: tree.blocks.map((b) => (b.type === "section" && b.id === ref.sectionId ? { ...b, children: items } : b)),
    } as PageBlockTree;
  }
  return {
    ...tree,
    blocks: tree.blocks.map((b) => {
      if (b.type !== "section") return b;
      return {
        ...b,
        children: b.children.map((c) => {
          if (c.type !== "row" || c.id !== ref.rowId) return c;
          return { ...c, columns: c.columns.map((col, i) => (i === ref.colIndex ? { ...col, children: items } : col)) };
        }),
      };
    }),
  } as PageBlockTree;
}

// Locates a block anywhere in the tree by id — root list, a section's children, or a row's
// column's children. Returns null for an unknown id (a stale drag event, e.g.).
export function findBlockLocation(tree: PageBlockTree, blockId: string): { block: Block; ref: ContainerRef; index: number } | null {
  const rootIdx = tree.blocks.findIndex((b) => b.id === blockId);
  if (rootIdx !== -1) return { block: tree.blocks[rootIdx], ref: { kind: "root" }, index: rootIdx };
  for (const b of tree.blocks) {
    if (b.type !== "section") continue;
    const idx = b.children.findIndex((c) => c.id === blockId);
    if (idx !== -1) return { block: b.children[idx], ref: { kind: "section", sectionId: b.id }, index: idx };
    for (const c of b.children) {
      if (c.type !== "row") continue;
      for (let colIndex = 0; colIndex < c.columns.length; colIndex++) {
        const eIdx = c.columns[colIndex].children.findIndex((e) => e.id === blockId);
        if (eIdx !== -1) return { block: c.columns[colIndex].children[eIdx], ref: { kind: "column", rowId: c.id, colIndex }, index: eIdx };
      }
    }
  }
  return null;
}

// Moves an existing block to a (possibly different) container at a given index. `toIndexRaw` is
// "insert before whatever is currently at this index in the target container" — for a same-
// container move this reproduces standard arrayMove semantics (adjusted for the fact that removal
// shifts later indices down by one before insertion). Structurally invalid moves (a locked block
// or Section leaving root, a Row leaving section-level, an element trying to sit at root) are
// silent no-ops — the client only needs a plausible result; validatePageBlockTree.ts is the real
// boundary and would reject any of these anyway if they somehow reached the server.
export function moveBlockToContainer(tree: PageBlockTree, blockId: string, toRef: ContainerRef, toIndexRaw: number): PageBlockTree {
  const loc = findBlockLocation(tree, blockId);
  if (!loc) return tree;
  const { block, ref: fromRef, index: fromIndex } = loc;

  if ("locked" in block || block.type === "section") {
    if (toRef.kind !== "root") return tree;
  } else if (block.type === "row") {
    if (toRef.kind !== "section") return tree;
  } else {
    if (toRef.kind === "root") return tree;
  }

  const sameContainer = containerKey(fromRef) === containerKey(toRef);
  const adjustedIndex = sameContainer && fromIndex < toIndexRaw ? toIndexRaw - 1 : toIndexRaw;

  const fromItems = getContainer(tree, fromRef);
  if (!fromItems) return tree;
  let next = withContainer(tree, fromRef, fromItems.filter((b) => b.id !== blockId));

  const toItems = getContainer(next, toRef);
  if (!toItems) return tree; // target container vanished (e.g. removed mid-drag) — bail out unchanged
  const clamped = Math.max(0, Math.min(adjustedIndex, toItems.length));
  next = withContainer(next, toRef, [...toItems.slice(0, clamped), block, ...toItems.slice(clamped)]);
  return next;
}

// Default seed content per element type — used when the palette inserts a brand-new instance.
function defaultElementContent(type: (typeof ELEMENT_BLOCK_TYPES)[number]): ElementBlock["content"] {
  switch (type) {
    case "heading":
      return { text: "New heading" };
    case "subheading":
      return { text: "New subheading" };
    case "paragraph":
      return { text: "New paragraph text." };
    case "image":
      return { dataUrl: null, alt: "" };
    case "bullet_list":
      return { items: ["First item"] };
    case "icon_list":
      return { items: [{ icon: ALLOWED_ICON_NAMES[0], text: "New item" }] };
    case "divider":
      return {};
    case "image_list":
      return { items: [{ imageDataUrl: null, caption: "New item" }] };
    case "button":
      return { text: "Click here", href: "https://example.com" };
    case "video":
      // No source: an empty block renders nothing rather than a placeholder, so a half-finished
      // page never ships a broken player to real traffic.
      return { source: null, title: "" };
    case "faq_item":
      return { question: "New question", answer: "Answer" };
    case "testimonial":
      // Defaults to the text variant: it is the only one that is complete the moment you insert
      // it, so the block never starts life looking broken while you go find an image.
      return { quote: "", name: "", role: "", media: { kind: "text" } };
  }
}

// Inserts a brand-new element of `type` into a section's or column's children at `index`.
// `ref.kind === "root"` is rejected (elements never live at root) — returns the tree unchanged.
export function insertElement(tree: PageBlockTree, ref: ContainerRef, index: number, type: (typeof ELEMENT_BLOCK_TYPES)[number]): PageBlockTree {
  if (ref.kind === "root") return tree;
  const items = getContainer(tree, ref);
  if (!items) return tree;
  const block: ElementBlock = { id: newBlockId(), type, style: {}, content: defaultElementContent(type) } as ElementBlock;
  const clamped = Math.max(0, Math.min(index, items.length));
  return withContainer(tree, ref, [...items.slice(0, clamped), block, ...items.slice(clamped)]);
}

// Inserts a brand-new Row (with `layout`'s fixed number of empty Columns — 1/2/3, no drag-to-
// resize, matching the confirmed "fixed presets" decision) into a section's children at `index`.
export function insertRow(tree: PageBlockTree, sectionId: string, index: number, layout: RowBlock["layout"]): PageBlockTree {
  const n = layout === "3col" ? 3 : layout === "2col" ? 2 : 1;
  const row: RowBlock = {
    id: newBlockId(),
    type: "row",
    layout,
    style: {},
    columns: Array.from({ length: n }, () => ({ id: newBlockId(), type: "column", style: {}, children: [] })),
  };
  const ref: ContainerRef = { kind: "section", sectionId };
  const items = getContainer(tree, ref);
  if (!items) return tree;
  const clamped = Math.max(0, Math.min(index, items.length));
  return withContainer(tree, ref, [...items.slice(0, clamped), row, ...items.slice(clamped)]);
}

// The "hero" image shown for Instagram posting / ad-creative fallback / servePublicCampaignImage
// is derived from the first image block found in document order — same concept as the pre-Phase-O
// editor's extractImageSrc() regex over rendered HTML, just reading the tree directly instead.
export function firstImageDataUrl(tree: PageBlockTree): string | null {
  for (const b of tree.blocks) {
    if (b.type !== "section") continue;
    for (const c of b.children) {
      if (c.type === "image" && c.content.dataUrl) return c.content.dataUrl;
      if (c.type === "row") {
        for (const col of c.columns) {
          for (const el of col.children) {
            if (el.type === "image" && el.content.dataUrl) return el.content.dataUrl;
          }
        }
      }
    }
  }
  return null;
}
