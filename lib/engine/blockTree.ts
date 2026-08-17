import { embedUrl, type VideoSource } from "./videoEmbed";
// Isomorphic and I/O-free, so importing it keeps this module's no-server-imports rule intact.
// The renderer re-checks each href defensively; validatePageBlockTree is still the boundary — same
// belt-and-braces the video block already applies by re-parsing its stored source.
import { isValidRedirectUrl } from "@/lib/validate";
import type { PageTheme } from "./pageTheme";

// The freeform block-tree page model (Phase O) — sections/rows/columns/elements, each stylable.
// Isomorphic, no server-only imports (same discipline as renderPages.ts, which re-exports this
// module's public surface so it stays the one stable import path every existing caller already
// uses). Kept in its own file because it's large; renderPages.ts owns the outer HTML document
// shell (doctype/head/style/submit-script) and both PageCopy-shaped functions that build it.

// Defined here (not renderPages.ts) so blockTree.ts has zero dependency on renderPages.ts —
// renderPages.ts imports/re-exports this instead, keeping the dependency one-directional even
// though renderPages.ts otherwise depends heavily on this module.
// Delivery-URL helper. lib/cloudinary/url.ts is ISOMORPHIC by design — it is the safe half of
// the Cloudinary integration. Never import lib/cloudinary/client.ts here: this module is
// bundled into five client editors, and node:crypto reaching one of them fails `next build`
// while `tsc` stays clean.
import { cloudinaryTransform, IMG_BLOCK } from "@/lib/cloudinary/url";

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

  /**
   * Block-level LAYOUT, distinct from the text-level keys above.
   *
   * `textAlign` aligns text INSIDE a box; `align` places the box itself, which is the thing an
   * inline-block button actually needed — with only textAlign, centring a button meant styling
   * whatever happened to contain it. Emitted on a wrapper, never on the element (see renderButton).
   */
  width?: "auto" | "full";
  align?: "left" | "center" | "right";

  /**
   * A form's INPUTS, not the form box. Emitted as CSS custom properties on the form wrapper, which
   * the stylesheet's own `.aos-form input` rules read with their pre-existing values as fallbacks —
   * so a form that sets none of these renders exactly as it did before these keys existed, and one
   * that sets some overrides only those. Same mechanism as pageTheme.ts, for the same reason:
   * per-input inline styles would mean the renderer knowing every control type's markup.
   */
  fieldBackgroundColor?: HexColor;
  fieldTextColor?: HexColor;
  fieldBorderColor?: HexColor;
  fieldBorderWidth?: number; // px, 0-8
  fieldBorderRadius?: number; // px, 0-40
  fieldGap?: number; // px, 0-40 — vertical space between fields
  /**
   * The FOCUSED state. ClickFunnels styles inputs in three states (Default / Focused / Value); a
   * focus ring is the one that carries real usability weight, so it is the one modelled here. It
   * has to be a CSS variable read by a `:focus` rule rather than an inline style — an inline
   * declaration cannot express a pseudo-class.
   */
  fieldFocusBorderColor?: HexColor;
  fieldFocusBackgroundColor?: HexColor;

  /**
   * Image sizing and framing — resize and crop, done in CSS rather than by re-encoding the file.
   *
   * Non-destructive on purpose. `resizeImageFile` (lib/images/resizeClient.ts) already downscales
   * every upload to 1000px and compresses it under the data-URL cap, so the bytes are handled at
   * the door; what's left is a display decision, and a display decision should be reversible. A
   * canvas re-crop would shrink the payload slightly and permanently throw away the pixels outside
   * the frame — the wrong trade for a control someone will nudge repeatedly while eyeballing a
   * page. Same instinct as `products.hoplink_override`: change the presentation, keep the source.
   *
   * `aspectRatio` is the crop. `objectFit: cover` (the default when a ratio is set) fills the frame
   * and clips the overflow; `contain` letterboxes instead, which is what you want for a logo or a
   * screenshot where losing an edge is worse than empty space. `focalX`/`focalY` decide WHICH part
   * survives a cover crop — the reason a portrait cropped to 16:9 doesn't have to lose the face.
   */
  imageWidth?: number; // %, 10-100 — display width of the image within its column
  aspectRatio?: AspectRatio;
  objectFit?: "cover" | "contain";
  focalX?: number; // %, 0-100 — object-position, only meaningful under a cover crop
  focalY?: number; // %, 0-100
};

/**
 * Crop frames, as a closed set mapped to real CSS values — never a tenant-typed ratio string.
 * "original" means no crop at all and emits nothing, so an image that never touches these controls
 * renders exactly the markup it did before they existed.
 */
export const ASPECT_RATIOS = {
  original: null,
  "1:1": "1 / 1",
  "4:3": "4 / 3",
  "3:2": "3 / 2",
  "16:9": "16 / 9",
  "4:5": "4 / 5",
  "9:16": "9 / 16",
} as const;
export type AspectRatio = keyof typeof ASPECT_RATIOS;
export const ASPECT_RATIO_NAMES = Object.keys(ASPECT_RATIOS) as AspectRatio[];

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
  if (has("width") && (style.width === "full" || style.width === "auto")) {
    // "auto" is the default and emits nothing, so an explicit auto can still UNDO a full width
    // when the panel writes it — the key being present is what matters, not the declaration.
    if (style.width === "full") parts.push("display:block", "width:100%", "box-sizing:border-box");
  }
  if (has("align") && typeof style.align === "string" && TEXT_ALIGNS.has(style.align)) {
    parts.push(`text-align:${style.align}`);
  }
  // Image sizing/framing. Order matters for the reader, not the parser: width first, then the
  // frame the width feeds, then which part of the picture survives it.
  const ratio =
    has("aspectRatio") && typeof style.aspectRatio === "string" && style.aspectRatio in ASPECT_RATIOS
      ? ASPECT_RATIOS[style.aspectRatio as AspectRatio]
      : null;
  if (has("imageWidth") || ratio) {
    const w = px(style.imageWidth, 10, 100);
    // A ratio without a width does nothing visible: `aspect-ratio` on a replaced element only
    // takes over once one axis is auto, and an untouched <img> is sized by its own pixels. So a
    // crop implies a width, defaulting to the full column.
    if (w !== null) parts.push(`width:${w}%`);
    else if (ratio) parts.push("width:100%");
  }
  if (ratio) {
    parts.push(`aspect-ratio:${ratio}`);
    // cover is the default because it is what "crop" means — contain letterboxes instead, for a
    // logo or screenshot where losing an edge is worse than empty space.
    const fit = style.objectFit === "contain" ? "contain" : "cover";
    parts.push(`object-fit:${fit}`);
    if (fit === "cover") {
      const fx = px(style.focalX, 0, 100);
      const fy = px(style.focalY, 0, 100);
      if (fx !== null || fy !== null) parts.push(`object-position:${fx ?? 50}% ${fy ?? 50}%`);
    }
  }
  // Custom properties, not declarations: the stylesheet's own rules consume these with their
  // pre-theme values as fallbacks, so unset keys change nothing.
  for (const [key, prop, min, max] of [
    ["fieldBorderWidth", "--f-bw", 0, 8],
    ["fieldBorderRadius", "--f-br", 0, 40],
    ["fieldGap", "--f-gap", 0, 40],
  ] as const) {
    if (has(key)) {
      const v = px(style[key], min, max);
      if (v !== null) parts.push(`${prop}:${v}px`);
    }
  }
  for (const [key, prop] of [
    ["fieldBackgroundColor", "--f-bg"],
    ["fieldTextColor", "--f-fg"],
    ["fieldBorderColor", "--f-bc"],
    ["fieldFocusBorderColor", "--f-focus-bc"],
    ["fieldFocusBackgroundColor", "--f-focus-bg"],
  ] as const) {
    if (has(key)) {
      const v = hex(style[key]);
      if (v) parts.push(`${prop}:${v}`);
    }
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

/**
 * Responsive visibility. A block can be hidden on any combination of the three widths the editor's
 * own device toggle previews.
 *
 * This is a CLASS, never an inline style — `styleToInlineCss` builds a `style="..."` attribute and
 * a media query cannot live in one. The three rules are defined once in `PAGE_STYLE`
 * (renderPages.ts) and once in `PUBLIC_CSS` (lib/blog.ts); those two stylesheets must not drift.
 */
export const VIEWPORTS = ["desktop", "tablet", "mobile"] as const;
export type Viewport = (typeof VIEWPORTS)[number];

type Base = { id: string; style: BlockStyle; hidden?: Viewport[] };

/** "hide-mobile hide-tablet", or "" when the block shows everywhere. */
export function visibilityClasses(block: { hidden?: readonly Viewport[] }): string {
  const set = block.hidden ?? [];
  return VIEWPORTS.filter((v) => set.includes(v))
    .map((v) => `hide-${v}`)
    .join(" ");
}

/**
 * Adds the visibility classes to a block's OWN root tag.
 *
 * Done here rather than threaded through `styleAttr` because most element cases already write
 * their own `class="..."` — two class attributes on one tag is invalid and the browser keeps only
 * the first, so the classes have to be merged into whichever attribute is already there. Safe to
 * parse by hand: `escapeHtml` turns `>` into `&gt;`, so no attribute value can contain the `>`
 * this looks for, and every render case returns either "" or a single root tag.
 */
function withVisibility(html: string, block: { hidden?: readonly Viewport[] }): string {
  const cls = visibilityClasses(block);
  if (!cls || !html.startsWith("<")) return html;
  const tagEnd = html.indexOf(">");
  if (tagEnd < 0) return html;
  const tag = html.slice(0, tagEnd);
  const existing = /\sclass="([^"]*)"/.exec(tag);
  if (existing) {
    return (
      tag.slice(0, existing.index) +
      ` class="${existing[1]} ${cls}"` +
      tag.slice(existing.index + existing[0].length) +
      html.slice(tagEnd)
    );
  }
  return `${tag} class="${cls}"${html.slice(tagEnd)}`;
}

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
// What a button DOES, as a closed union rather than a URL string with special values smuggled
// into it. Only `link` produces an href; the rest are data attributes a code-owned script reads,
// so there is still no path from tenant input to a navigable URL except the validated one.
export type ButtonAction =
  | { kind: "link"; href: string }
  /** Smooth-scroll to a section on the same page. targetId is matched against real block ids. */
  | { kind: "scroll"; targetId: string }
  /** Open a form block on this page as a modal. formId is matched against real form block ids. */
  | { kind: "popup"; formId: string }
  /** Submit the form this button sits inside. */
  | { kind: "submit" };

export const BUTTON_ACTION_KINDS = ["link", "scroll", "popup", "submit"] as const;

// What happens once a form has saved. Same closed-union discipline as ButtonAction, for the same
// reason: only `url` yields a navigable destination and it goes through isValidRedirectUrl, while
// the rest are data attributes a code-owned script reads. `offer` is resolved at RENDER time from
// RenderCtx — the tenant never types the hoplink, so a form can point at the offer without the
// affiliate link ever passing through page content.
export type FormSubmitAction =
  /** The campaign's offer: the next funnel step when the funnel has one, else the hoplink. */
  | { kind: "offer" }
  /** A destination the tenant types. */
  | { kind: "url"; href: string }
  /** Open another form block on this page as a modal. */
  | { kind: "popup"; formId: string }
  /** Stay on the page and swap the form for its success text. */
  | { kind: "message" }
  /** Send each answer somewhere different — see BranchTarget below. */
  | {
      kind: "branch";
      /** Names a field on THIS form, the same way FieldCondition.fieldKey does. */
      fieldKey: string;
      rules: { value: string; then: BranchTarget }[];
      /** Where an answer matching no rule goes. Never optional — a quiz must always land somewhere. */
      otherwise: BranchTarget;
    };

// Where one answer sends someone. Deliberately NOT recursive into FormSubmitAction: `popup` and a
// nested `branch` would both need the client script to make a decision, and the whole point of the
// encoding below is that it makes none.
//
// `step` names a funnel_steps ROW ID, never a step_index. move_funnel_step
// (supabase/migrations/0023_funnel_steps.sql) SWAPS step_index values between two rows, so an index
// stored here would silently start pointing at a different page after any reorder — the worst shape
// of bug this codebase has: real ad traffic sent somewhere wrong, with nothing on screen saying so.
// Keyed by row id it is self-healing, because rerenderFunnelSequence re-bakes every href after any
// add/move/delete.
export type BranchTarget =
  | { kind: "offer" }
  | { kind: "url"; href: string }
  | { kind: "step"; stepId: string }
  | { kind: "message" };

export const FORM_SUBMIT_ACTION_KINDS = ["offer", "url", "popup", "message", "branch"] as const;
export const BRANCH_TARGET_KINDS = ["offer", "url", "step", "message"] as const;

export type ButtonBlock = Base & {
  type: "button";
  // `href` is kept for pages saved before actions existed — normalizePageCopy/validate promote it
  // into {kind:"link"} rather than a migration, same permanent-adapter habit as PageCopy.
  content: { text: string; action?: ButtonAction; href?: string };
};

// A real, droppable form — as many per page as you like, or none. Distinct from the locked
// lead_capture_form on a funnel opt-in page, which stays as it is for pages that use it; this is
// the general one, and it posts to the same /api/public/leads with the same field-key checks
// rather than growing a second write path for anonymous visitors.
export type FormBlock = Base & {
  type: "form";
  content: {
    title: string;
    submitText: string;
    successText: string;
    /** Rendered hidden, shown only by a button's popup action. */
    popup: boolean;
    /** Same union the opt-in form uses. Absent = {kind:"message"} — this form's existing behavior. */
    afterSubmit?: FormSubmitAction;
    /**
     * Show one question at a time with Next/Back. Purely presentational — the same fields are
     * submitted either way, so nothing downstream (extractLeadFormFields, /api/public/leads,
     * contacts.extra_fields) sees any difference.
     *
     * Absent/false means today's behavior exactly, which is what keeps every stored page unchanged.
     * Stripped on blog pages by the validator: it is the one form flag that ships a script, and a
     * blog post shipping JS is the property the carousel block was built in pure CSS to protect.
     */
    stepped?: boolean;
  };
  children: FormInputBlock[];
};
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

// Swipeable image slides. Rendered as a CSS scroll-snap track, NOT a JS carousel: it swipes
// natively on touch, scrolls with a trackpad, takes keyboard arrows once focused, and needs no
// script at all — which is what lets it appear on a blog post without breaking the "public pages
// ship zero JS" property. The trade is no auto-advance and no arrow buttons; both would need a
// script for something a finger already does.
export type CarouselBlock = Base & {
  type: "carousel";
  content: { slides: { imageDataUrl: string | null; caption: string }[] };
};

// A countdown is the one block here that genuinely cannot work without JS.
//
// `date` counts to a real deadline. `evergreen` counts N minutes from a visitor's FIRST view and
// remembers it (localStorage, keyed by block id) — so a refresh does not hand them a fresh
// timer. That persistence is the whole point: a countdown that resets on reload is telling every
// visitor the offer expires and then proving it doesn't, which is the deceptive-urgency pattern
// regulators actually act on, and content rule 2 already forbids inventing urgency. It does not
// loop, and when it hits zero it says so.
export type CountdownMode = "date" | "evergreen";
export const COUNTDOWN_MODES = ["date", "evergreen"] as const;

export type CountdownBlock = Base & {
  type: "countdown";
  content: {
    mode: CountdownMode;
    /** ISO instant, `date` mode only. */
    deadline: string | null;
    /** Minutes from first view, `evergreen` mode only. */
    minutes: number;
    label: string;
    expiredText: string;
  };
};

/**
 * Raw HTML/CSS/JS, injected into the published page verbatim.
 *
 * This block is the deliberate exception to the rule the rest of this file exists to enforce —
 * `styleToInlineCss`'s fixed key table, `parseVideoUrl` rebuilding embed URLs from a template,
 * `ICON_SVG_PATHS` as an allowlist, `extractTrackingId` throwing away pasted markup. Every one of
 * those is here so no tenant-typed string can become executable output. `custom_html` is that path,
 * on purpose, because a page builder without an embed widget can't host a booking widget, a chat
 * bubble, or a third-party pixel someone's affiliate network handed them.
 *
 * What that costs, stated plainly because it is not recoverable by being careful elsewhere: funnel
 * and blog pages serve on the app's own origin (`/p/…`, `/b/…`, and workspace subdomains) and the
 * session cookie is domain-wide (lib/supabase/cookieOptions.ts), so code pasted here runs
 * same-origin with the app. `httpOnly` does not help — a same-origin `fetch` carries the session
 * anyway. A signed-in visitor loading a page that carries someone else's snippet is exposed to it.
 * On a tenant's own verified custom domain that is just "my site, my script"; on the default URL it
 * is not. Chosen knowingly (see CLAUDE.md) — the escape hatch is what the block is for.
 *
 * So: never escape this, never "sanitize" it into something half-working, and never let a template
 * or an AI stage emit one. It is insertable only by a human, from the palette.
 */
export type CustomHtmlBlock = Base & { type: "custom_html"; content: { code: string } };

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
  | TestimonialBlock
  | CarouselBlock
  | CountdownBlock
  | CustomHtmlBlock
  | FormBlock
  | FooterBlock
  | ProgressBlock
  | NavigationBlock
  | IconBlock;

/**
 * What a form field COLLECTS, as a named list rather than an input type.
 *
 * The dropdown people want says "Phone", not "tel" — the input type and the field key are
 * consequences of that choice, not separate decisions. Keeping them together here is also what
 * stops a "Phone" field from being stored under a random key: `fieldKey` becomes the CSV column
 * header and the JSON key in contacts.extra_fields, so it has to stay readable.
 *
 * `first_name`/`email` are deliberately absent: the form renders those itself and they can't be
 * removed, so offering them would create a duplicate that silently overwrites the real one.
 */
import { SMS_CONSENT_FIELD_KEY } from "@/lib/sms";

export const FORM_FIELD_PRESETS: {
  id: string;
  label: string;
  fieldKey: string;
  fieldType: FormFieldType;
  placeholder?: string;
}[] = [
  { id: "last_name", label: "Last name", fieldKey: "last_name", fieldType: "text", placeholder: "Last name" },
  { id: "full_name", label: "Full name", fieldKey: "full_name", fieldType: "text", placeholder: "Full name" },
  { id: "phone", label: "Phone", fieldKey: "phone", fieldType: "tel", placeholder: "Phone number" },
  { id: "alt_email", label: "Second email", fieldKey: "alt_email", fieldType: "email", placeholder: "Email address" },
  { id: "company", label: "Company", fieldKey: "company", fieldType: "text", placeholder: "Company name" },
  { id: "website", label: "Website", fieldKey: "website", fieldType: "url", placeholder: "https://" },
  { id: "budget", label: "Budget", fieldKey: "budget", fieldType: "number", placeholder: "Budget" },
  { id: "message", label: "Message", fieldKey: "message", fieldType: "textarea", placeholder: "Your message" },
  { id: "consent", label: "Checkbox", fieldKey: "consent", fieldType: "checkbox" },
  // The SMS pair. Separate from the generic checkbox because the KEY is what the leads route
  // looks for — a box labelled "text me" with any other key records nothing. See lib/sms.ts.
  { id: "sms_consent", label: "SMS consent", fieldKey: SMS_CONSENT_FIELD_KEY, fieldType: "checkbox" },
  { id: "choice", label: "Choose one", fieldKey: "choice", fieldType: "radio" },
  { id: "dropdown", label: "Dropdown", fieldKey: "dropdown", fieldType: "select", placeholder: "Select one…" },
  { id: "custom", label: "Something else", fieldKey: "custom", fieldType: "text", placeholder: "" },
];

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
  "carousel",
  "countdown",
  "custom_html",
  "form",
  "footer",
  "progress",
  "navigation",
  "icon",
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
    /** "half" lets two consecutive fields share a row. Defaults to full width. */
    width?: "full" | "half";
    /**
     * Where the field's label sits. ClickFunnels' Label Position, plus a third value they don't
     * have: "none" is the DEFAULT and is what every field rendered before this existed
     * (placeholder only), so no stored page changes appearance until someone opts in.
     */
    labelPosition?: "none" | "above" | "border";
    /** Show this field only when another field on the same form holds a given value. */
    visibleWhen?: FieldCondition;
  };
};

/**
 * Conditional logic, as a closed union — same discipline as ButtonAction and FormSubmitAction.
 *
 * `fieldKey` names a SIBLING field on the same form; the validator drops the rule if it names
 * nothing, rather than failing the save. A page you cannot save because you deleted the field a
 * condition pointed at would be a page you cannot edit your way out of.
 */
export const FIELD_CONDITION_OPS = ["equals", "not_equals", "filled", "empty"] as const;
export type FieldConditionOp = (typeof FIELD_CONDITION_OPS)[number];
export type FieldCondition = {
  fieldKey: string;
  op: FieldConditionOp;
  /** Ignored by `filled`/`empty`, which test presence rather than a value. */
  value?: string;
};

/**
 * The page's closing line: a business/legal footer, not a general text block.
 *
 * It exists as its own type rather than "a paragraph you put at the bottom" because it renders a
 * real <footer> landmark and carries LINKS — the privacy/terms/contact row a page taking paid
 * traffic is repeatedly asked for. Each href goes through the same isValidRedirectUrl a button's
 * does, so there is no second, looser path from typed text to a navigable URL.
 *
 * Distinct from the locked `disclosure` block, which is the mandatory affiliate notice and is
 * hoisted last by the renderer regardless. A footer never replaces it.
 */
export type FooterBlock = Base & {
  type: "footer";
  content: { text: string; links: { label: string; href: string }[] };
};

/** A nav bar can hold at most this many links. Past ~6 it wraps and stops being a nav. */
export const MAX_NAV_LINKS = 6;

/**
 * The page's top bar: a brand mark plus a short row of links.
 *
 * Links carry a full `ButtonAction`, not a bare href, because the overwhelmingly common nav on a
 * landing page points at sections of the SAME page — so `scroll` has to be first-class here, and
 * once it is, `popup` (open the opt-in form) comes free from the union the button block already
 * uses. There is no second, looser path from typed text to a navigable URL: `link` goes through
 * the same isValidRedirectUrl, and the other kinds are ids a code-owned script resolves.
 *
 * `submit` is deliberately not offered — a nav sits outside any form, so it would do nothing.
 */
export type NavigationBlock = Base & {
  type: "navigation";
  content: {
    brand: string;
    brandImageDataUrl: string | null;
    links: { label: string; action: ButtonAction }[];
    /** Pins the bar to the top as the page scrolls. Pure CSS — no script either way. */
    sticky: boolean;
  };
};

/**
 * A single icon, at a size you choose — the decorative sibling of `icon_list`.
 *
 * `name` is a key into ICON_SVG_PATHS and nothing else: an unknown value renders nothing rather
 * than being interpolated anywhere, which is the same closed-set rule that makes the icon list
 * safe. Nothing here is fetched, so an icon costs a page no request.
 */
export type IconBlock = Base & {
  type: "icon";
  content: { name: string; size: number; label: string };
};

export const MIN_ICON_SIZE = 16;
export const MAX_ICON_SIZE = 160;

/**
 * A static progress/completion bar — "Step 2 of 3", "68% of the guide covered".
 *
 * No script: the fill width is baked into the style attribute at render time, so it costs a blog
 * post nothing and works with JS disabled. Same reasoning as the carousel being CSS-only.
 *
 * **The number is whatever the operator types, and it is presented as a fact to paid traffic.** A
 * bar reading "82% claimed" that isn't measuring anything is the fabricated-scarcity pattern
 * content rule 2 rules out and the one regulators actually act on — the same trap the countdown
 * block's evergreen cap exists to avoid. The editor says so at the point of entry; the renderer
 * cannot know, so it does not pretend to.
 */
export type ProgressBlock = Base & {
  type: "progress";
  content: { label: string; percent: number; caption: string };
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
  // afterSubmit is what replaced the separate primary_cta button on an opt-in page: the form's
  // own submit decides where the lead goes next, so the page no longer carries a second button
  // that only appears after submitting. Absent = {kind:"offer"}, which is exactly where the old
  // reveal-then-click CTA pointed.
  // `stepped` is here as well as on FormBlock because the opt-in form is the one a Survey funnel
  // actually uses — the bucket questions are its children. Same presentational-only meaning.
  content: {
    ctaText: string;
    afterSubmit?: FormSubmitAction;
    successText?: string;
    stepped?: boolean;
  };
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
  /**
   * What query this page is written FOR. Planned by the build kit and editable per page.
   *
   * On the TREE for the same reason contentWidth and theme are: `page_copy` is the one field a
   * funnel opt-in, a split-test variant, a funnel step and a blog post all already have, so one
   * slot covers four page kinds with no migration and no per-table column to keep in step.
   *
   * It intentionally renders NOTHING. Stuffing the primary keyword into a meta tag is the 2009
   * move — Google dropped `meta keywords` as a ranking signal long ago and it now mostly tells
   * competitors what you are targeting. This exists to steer generation and to be visible while
   * editing, not to be emitted.
   */
  keywords?: PageKeywords;
};

export type PageKeywords = {
  primary: string;
  secondary: string[];
  /** Informational / commercial / transactional — what the searcher is trying to DO. */
  intent?: string;
};

export const MAX_SECONDARY_KEYWORDS = 8;

/** Defensive read: a hand-edited or legacy row may carry anything in this slot. */
export function keywordsOf(tree: PageBlockTree | null | undefined): PageKeywords | null {
  const k = tree?.keywords;
  if (!k || typeof k.primary !== "string" || !k.primary.trim()) return null;
  return {
    primary: k.primary.trim(),
    secondary: Array.isArray(k.secondary)
      ? k.secondary.filter((x): x is string => typeof x === "string" && x.trim() !== "").slice(0, MAX_SECONDARY_KEYWORDS)
      : [],
    ...(typeof k.intent === "string" && k.intent.trim() ? { intent: k.intent.trim() } : {}),
  };
}

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

function renderIcon(name: string, size = 20): string {
  const inner = ICON_SVG_PATHS[name];
  if (!inner) return "";
  // Only a clamped integer reaches the attribute — the same rule contentWidth follows, for the
  // same reason: this is a stored value on its way into rendered markup.
  const px = Math.max(MIN_ICON_SIZE, Math.min(MAX_ICON_SIZE, Math.round(Number(size) || 20)));
  return `<svg width="${px}" height="${px}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
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
  /**
   * Every step of this funnel, in order, so a branch rule can name one. `nextStepUrl` above is
   * only the FIRST step, which cannot express "answer B goes to step 3".
   *
   * Keyed by funnel_steps.id, resolved to a URL here at bake time — see BranchTarget for why an
   * index would be wrong. Populated by rerenderFunnelSequence (lib/funnelSteps.ts), which already
   * loads every step and owns stepUrl(). Absent on blog pages and on a funnel with no steps; a
   * branch naming a step that isn't here falls back to its `otherwise`, never to a dead link.
   */
  steps?: { id: string; url: string }[];
  productTitle: string;
  /** Set by renderBlockTree from the tree itself — never passed in. See the CTA's reveal. */
  /**
   * Whether the page has ANY form — the locked opt-in one or a droppable `form` block, at any
   * depth. Set by renderBlockTree from the tree itself, never passed in.
   *
   * Deliberately not "has a lead_capture_form": a standalone form nested in a section collects
   * leads and has its own after-submit action just the same, so a page carrying one plus a
   * primary_cta had the exact two-button problem this replaced.
   */
  hasForm?: boolean;
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
  "width",
] as const;
/** Placement of the button box itself — emitted on its wrapper, not on the button. */
export const BUTTON_WRAP_STYLE_KEYS = ["align"] as const;
/** Resize and crop, on the <img> itself. See the BlockStyle comment for why this is CSS, not a re-encode. */
export const IMAGE_STYLE_KEYS = [
  ...BOX_STYLE_KEYS,
  "imageWidth",
  "aspectRatio",
  "objectFit",
  "focalX",
  "focalY",
] as const;
/**
 * Where a narrowed image sits. Same wrapper trick as the button, and for the same reason: the
 * image is `display:block`, so `text-align` on it does nothing — only auto margins move it, and
 * those belong to a containing box. Emitted only when an alignment is actually set, so an
 * untouched image's markup is byte-for-byte what it was before these keys existed.
 */
export const IMAGE_WRAP_STYLE_KEYS = ["align"] as const;
export const IMAGE_PANEL_STYLE_KEYS = [...IMAGE_STYLE_KEYS, ...IMAGE_WRAP_STYLE_KEYS] as const;
/** What the style PANEL offers for a button — the element's own keys plus its wrapper's. */
export const BUTTON_PANEL_STYLE_KEYS = [...BUTTON_STYLE_KEYS, ...BUTTON_WRAP_STYLE_KEYS] as const;
export const DIVIDER_STYLE_KEYS = ["borderColor", "borderWidth", "marginTop", "marginBottom"] as const;
/** A form: the box (BOX keys) plus its inputs' own look and spacing. */
export const FORM_STYLE_KEYS = [
  ...BOX_STYLE_KEYS,
  "align",
  "fieldBackgroundColor",
  "fieldTextColor",
  "fieldBorderColor",
  "fieldBorderWidth",
  "fieldBorderRadius",
  "fieldGap",
  "fieldFocusBorderColor",
  "fieldFocusBackgroundColor",
] as const;

// form_input has no entry here — it's never independently selectable/stylable in the editor (it
// only ever renders inside the lead-capture form's fixed layout), but every other BlockType needs
// one so this Record stays exhaustive (a missing case is a compile error, not a silent gap).
export const STYLE_KEYS_BY_TYPE: Record<Exclude<BlockType, "form_input">, readonly (keyof BlockStyle)[]> = {
  heading: TEXT_STYLE_KEYS,
  subheading: TEXT_STYLE_KEYS,
  paragraph: TEXT_STYLE_KEYS,
  image: IMAGE_PANEL_STYLE_KEYS,
  bullet_list: TEXT_STYLE_KEYS,
  icon_list: TEXT_STYLE_KEYS,
  divider: DIVIDER_STYLE_KEYS,
  image_list: TEXT_STYLE_KEYS,
  testimonial: TEXT_STYLE_KEYS,
  carousel: BOX_STYLE_KEYS,
  countdown: TEXT_STYLE_KEYS,
  // BOX only: the code decides its own typography. Offering a font size here would set it on a
  // wrapper the pasted markup is free to override, so the control would work or not depending on
  // what was pasted — worse than not offering it.
  custom_html: BOX_STYLE_KEYS,
  form: FORM_STYLE_KEYS,
  footer: TEXT_STYLE_KEYS,
  progress: TEXT_STYLE_KEYS,
  navigation: TEXT_STYLE_KEYS,
  icon: TEXT_STYLE_KEYS,
  button: BUTTON_PANEL_STYLE_KEYS,
  video: BOX_STYLE_KEYS,
  faq_item: TEXT_STYLE_KEYS,
  column: BOX_STYLE_KEYS,
  row: BOX_STYLE_KEYS,
  section: BOX_STYLE_KEYS,
  disclosure: TEXT_STYLE_KEYS,
  lead_capture_form: FORM_STYLE_KEYS,
  primary_cta: BUTTON_PANEL_STYLE_KEYS,
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
    case "image": {
      if (!block.content.dataUrl) return "";
      const img = `<img src="${escapeHtml(cloudinaryTransform(block.content.dataUrl, IMG_BLOCK))}" alt="${escapeHtml(
        block.content.alt || ctx.productTitle
      )}"${styleAttr(block.style, IMAGE_STYLE_KEYS)} class="block-img" />`;
      // A CLASS, not an inline text-align: the image is display:block, so text-align on a parent
      // does nothing to it — only auto margins move it, and no stylesheet can derive those from an
      // alignment value. The class name comes from a literal in a closed comparison, never from
      // interpolating the stored value. Emitted only when alignment is set, so an untouched
      // image's markup is what it was before these keys existed.
      const a = block.style?.align;
      return a === "center" || a === "right" ? `<div class="img-wrap-${a}">${img}</div>` : img;
    }
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
              i.imageDataUrl ? `<img src="${escapeHtml(cloudinaryTransform(i.imageDataUrl, IMG_BLOCK))}" alt="" />` : ""
            }<span>${escapeHtml(i.caption)}</span></div>`
        )
        .join("")}</div>`;
    case "button": {
      const style = styleAttr(block.style, BUTTON_STYLE_KEYS);
      const label = escapeHtml(block.content.text);
      // Legacy rows stored a bare href; treat that as {kind:"link"} rather than migrating.
      const action: ButtonAction =
        block.content.action ?? { kind: "link", href: block.content.href ?? "#" };
      const el = (() => {
        switch (action.kind) {
          case "link":
            return `<a class="block-btn" href="${escapeHtml(action.href)}"${style}>${label}</a>`;
          case "scroll":
            // A button, not an anchor: the target is a block id resolved by the page's own script,
            // never a URL, so this can't be pointed off-site by editing the stored value.
            return `<button type="button" class="block-btn" data-scroll-to="${escapeHtml(action.targetId)}"${style}>${label}</button>`;
          case "popup":
            return `<button type="button" class="block-btn" data-open-form="${escapeHtml(action.formId)}"${style}>${label}</button>`;
          case "submit":
            return `<button type="submit" class="block-btn"${style}>${label}</button>`;
        }
      })();
      // Placement goes on a wrapper because a button is inline-block: text-align on the button
      // itself centres its LABEL, not the button. Only emitted when an alignment is actually set,
      // so an untouched button's markup is unchanged.
      const wrap = styleAttr(block.style, BUTTON_WRAP_STYLE_KEYS);
      // A scroll/popup button needs the click handler, and until now only the FORM block emitted
      // it — so one of these on a page with no form was a button that visibly did nothing. The
      // script self-guards on `window.__aosForms`, so emitting it from both places costs nothing.
      const script = action.kind === "scroll" || action.kind === "popup" ? FORM_ACTION_SCRIPT : "";
      return (wrap ? `<div${wrap}>${el}</div>` : el) + script;
    }
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
    case "progress": {
      const { label, caption } = block.content;
      // Clamped here as well as in the validator: this number becomes a CSS width, and the one
      // place a stored value reaches a style attribute is the place to be certain about it.
      const pct = Math.max(0, Math.min(100, Math.round(Number(block.content.percent) || 0)));
      return `<div class="progress-block"${styleAttr(block.style, TEXT_STYLE_KEYS)}>${
        label.trim() ? `<div class="progress-label"><span>${escapeHtml(label)}</span><span>${pct}%</span></div>` : ""
      }<div class="progress-track" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"${
        label.trim() ? ` aria-label="${escapeHtml(label)}"` : ""
      }><div class="progress-fill" style="width:${pct}%"></div></div>${
        caption.trim() ? `<p class="progress-caption">${escapeHtml(caption)}</p>` : ""
      }</div>`;
    }
    case "navigation": {
      const { brand, brandImageDataUrl, links, sticky } = block.content;
      const linkHtml = (links ?? [])
        .filter((l) => l.label.trim())
        .map((l) => {
          const label = escapeHtml(l.label);
          switch (l.action.kind) {
            case "link":
              return `<a href="${escapeHtml(l.action.href)}">${label}</a>`;
            case "scroll":
              return `<button type="button" data-scroll-to="${escapeHtml(l.action.targetId)}">${label}</button>`;
            case "popup":
              return `<button type="button" data-open-form="${escapeHtml(l.action.formId)}">${label}</button>`;
            // A nav sits outside every form, so a submit link would be a button that does nothing.
            case "submit":
              return "";
          }
        })
        .join("");
      const brandHtml = brandImageDataUrl
        ? `<img class="page-nav-logo" src="${escapeHtml(cloudinaryTransform(brandImageDataUrl, IMG_BLOCK))}" alt="${escapeHtml(brand)}" />`
        : brand.trim()
          ? `<span class="page-nav-brand">${escapeHtml(brand)}</span>`
          : "";
      // Nothing to show is nothing to render, like an empty footer — an empty bar at the top of a
      // page taking paid traffic is worse than no bar.
      if (!brandHtml && !linkHtml) return "";
      // Only a nav that actually has a scroll/popup link needs the shared click handler. It is
      // idempotent (`window.__aosForms`), so emitting it here as well as beside a form is free.
      const needsScript = (links ?? []).some((l) => l.action.kind === "scroll" || l.action.kind === "popup");
      return `<nav class="page-nav${sticky ? " is-sticky" : ""}"${styleAttr(block.style, TEXT_STYLE_KEYS)}><div class="page-nav-inner">${brandHtml}${
        linkHtml ? `<div class="page-nav-links">${linkHtml}</div>` : ""
      }</div></nav>${needsScript ? FORM_ACTION_SCRIPT : ""}`;
    }
    case "icon": {
      const svg = renderIcon(block.content.name, block.content.size);
      if (!svg) return "";
      const label = block.content.label.trim();
      return `<div class="icon-block"${styleAttr(block.style, TEXT_STYLE_KEYS)}>${svg}${
        label ? `<span>${escapeHtml(label)}</span>` : ""
      }</div>`;
    }
    case "footer": {
      const { text, links } = block.content;
      const linkHtml = (links ?? [])
        .filter((l) => l.label.trim() && isValidRedirectUrl(l.href))
        .map((l) => `<a href="${escapeHtml(l.href)}">${escapeHtml(l.label)}</a>`)
        .join("");
      // A footer with neither a line of text nor a usable link renders nothing, like an empty
      // testimonial — an empty grey bar at the end of the page is worse than no bar.
      if (!text.trim() && !linkHtml) return "";
      return `<footer class="page-footer"${styleAttr(block.style, TEXT_STYLE_KEYS)}>${
        text.trim() ? `<p>${escapeHtml(text)}</p>` : ""
      }${linkHtml ? `<nav class="page-footer-links">${linkHtml}</nav>` : ""}</footer>`;
    }
    case "faq_item":
      // An accordion via native <details>/<summary> — NO script. That is what lets an FAQ sit on a
      // blog post without breaking that page's zero-JS property, the same reasoning that made the
      // carousel CSS-only. It is also keyboard- and screen-reader-accessible for free, and it
      // still prints and still finds text via Ctrl+F in modern browsers.
      //
      // The stored shape is UNCHANGED — same question/answer content — so every existing faq_item
      // becomes collapsible on its next render with no migration. That IS a visible change to live
      // pages: answers now start closed.
      return `<details class="faq-item"${styleAttr(block.style, TEXT_STYLE_KEYS)}><summary>${escapeHtml(
        block.content.question
      )}</summary><p>${escapeHtml(block.content.answer)}</p></details>`;
    case "testimonial": {
      const { quote, name, role, media } = block.content;
      // An empty testimonial renders nothing rather than an attributed-to-nobody quote box — same
      // call as the video block's null source: a half-filled block must not ship to real traffic.
      if (!quote.trim() && !name.trim() && media.kind === "text") return "";

      let mediaHtml = "";
      if (media.kind === "image" && media.dataUrl) {
        mediaHtml = `<div class="tm-media tm-avatar"><img src="${escapeHtml(cloudinaryTransform(media.dataUrl, IMG_BLOCK))}" alt="${escapeHtml(
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
    case "carousel": {
      const slides = block.content.slides.filter((s) => s.imageDataUrl);
      if (slides.length === 0) return "";
      // A scroll-snap track, not a JS carousel: native swipe on touch, trackpad scroll on desktop,
      // arrow keys once focused (tabindex makes the overflow container focusable, which is also
      // what makes it keyboard-reachable at all). No script, so this block is safe to drop on a
      // blog post without breaking that page's zero-JS property.
      return `<div class="carousel" tabindex="0" role="group" aria-roledescription="carousel" aria-label="Images"${styleAttr(
        block.style,
        BOX_STYLE_KEYS
      )}>${slides
        .map(
          (s, i) =>
            `<figure class="slide" aria-label="${i + 1} of ${slides.length}"><img src="${escapeHtml(
              cloudinaryTransform(s.imageDataUrl as string, IMG_BLOCK)
            )}" alt="${escapeHtml(s.caption)}" loading="lazy" />${
              s.caption.trim() ? `<figcaption>${escapeHtml(s.caption)}</figcaption>` : ""
            }</figure>`
        )
        .join("")}</div>`;
    }
    case "form": {
      const { title, submitText, successText, popup } = block.content;
      // `?? []` deliberately: this renders a page served to paid ad traffic, so a block missing
      // its children array must degrade to "no extra fields" rather than throw and take the whole
      // page down. The validator already normalizes this on save; this covers everything else.
      const fieldList = (block.children ?? []).map((f) => renderFormField(f)).filter(Boolean);
      const contactInputs = `<input type="text" name="first_name" placeholder="First name" autocomplete="given-name" />
    <input type="email" name="email" placeholder="Email address" required autocomplete="email" />`;
      // Same ordering rule as the opt-in form: questions first, contact details last, but only
      // when stepped. Unstepped is byte-identical to before.
      const formBody = block.content.stepped
        ? steppedBody([...fieldList, contactInputs])
        : `${contactInputs}
    ${fieldList.join("")}`;
      // Posts to the same endpoint as the locked opt-in form, with the same field-key validation
      // server-side — a second write path for anonymous visitors is exactly what shouldn't exist.
      return `<div class="aos-form-wrap${popup ? " aos-form-popup" : ""}" id="${escapeHtml(block.id)}"${
        popup ? " hidden" : ""
      }${styleAttr(block.style, FORM_STYLE_KEYS)}>
  <form class="aos-form" data-aos-form="1" data-campaign="${escapeHtml(ctx.campaignId)}"${afterSubmitAttrs(
        block.content.afterSubmit,
        ctx,
        "message"
      )}>
    ${popup ? '<button type="button" class="aos-form-close" data-close-form="1" aria-label="Close">&times;</button>' : ""}
    ${title.trim() ? `<h3>${escapeHtml(title)}</h3>` : ""}
    ${formBody}${branchRulesHtml(block.content.afterSubmit, ctx)}
    <p class="consent-note">${escapeHtml(ctx.leadConsentText)}</p>
    <button type="submit" class="cta">${escapeHtml(submitText || "Send")}</button>
    <p class="aos-form-done" hidden>${escapeHtml(successText || "Thanks.")}</p>
  </form>
</div>${FORM_ACTION_SCRIPT}${
        block.children.some((f) => f.content.visibleWhen) ? FORM_CONDITION_SCRIPT : ""
      }${block.content.stepped ? FORM_STEPPED_SCRIPT : ""}${
        block.content.afterSubmit?.kind === "branch" ? BRANCH_RESOLVE_SCRIPT : ""
      }`;
    }
    case "custom_html": {
      const code = block.content.code;
      // Empty renders nothing — same call as a video with no source. An empty wrapper with the
      // block's padding on it would show as an unexplained gap on a live page.
      if (!code.trim()) return "";
      // Verbatim. The `id` is safe to interpolate (ID_RE-checked by the validator, same as every
      // other block's) and is what lets a button scroll to this block.
      return `<div class="custom-html" id="${escapeHtml(block.id)}"${styleAttr(block.style, BOX_STYLE_KEYS)}>${code}</div>`;
    }
    case "countdown": {
      const { mode, deadline, minutes, label, expiredText } = block.content;
      const target = mode === "date" ? Date.parse(deadline ?? "") : NaN;
      // A date-mode block with no usable deadline renders nothing rather than a stuck "00:00:00".
      if (mode === "date" && !Number.isFinite(target)) return "";

      // Only NUMBERS reach the script — the deadline as epoch ms, the minutes as an integer. All
      // visible text is escaped into the HTML, never interpolated into JS. The script itself is
      // code-owned and constant; it reads data attributes and writes textContent only.
      const data =
        mode === "date"
          ? ` data-mode="date" data-until="${target}"`
          : ` data-mode="evergreen" data-minutes="${Math.round(minutes)}"`;
      return `<div class="countdown" id="${escapeHtml(block.id)}"${data}${styleAttr(block.style, TEXT_STYLE_KEYS)}>${
        label.trim() ? `<div class="cd-label">${escapeHtml(label)}</div>` : ""
      }<div class="cd-clock" aria-live="polite">--:--:--</div><div class="cd-expired" hidden>${escapeHtml(
        expiredText
      )}</div></div>${COUNTDOWN_SCRIPT}`;
    }
  }
}

// Emitted once per countdown block (browsers are fine with that; the guard makes re-runs cheap).
// Inlined next to the block rather than in the page shell so a page WITHOUT a countdown still
// ships no script at all — which is what keeps blog posts zero-JS by default.
//
// Evergreen deadlines persist in localStorage keyed by block id: a countdown that resets on every
// refresh tells each visitor the offer is expiring and then proves it isn't, which is the
// deceptive-urgency pattern content rule 2 already rules out. It does not loop; at zero it swaps
// in the expired message.
// Drives every button action that isn't a plain link, plus standalone form submission. Inlined
// once (guarded) alongside the first form/action button, so a page using none of this still ships
// no script. Reads only data attributes and matches them against elements that actually exist —
// a stored id that names nothing simply does nothing.
/**
 * Conditional-logic runtime. Emitted only next to a form that actually has a condition, so a page
 * without one still ships no extra script — the same rule the countdown block follows.
 *
 * **A hidden field is DISABLED, not merely hidden.** `display:none` still submits its value, so a
 * question the visitor never saw would arrive as an answer. Disabling is what makes "this field
 * does not apply" true in the data as well as on screen — and the leads route validates against
 * the page's field list, so a stale value there would look legitimate.
 *
 * Nothing from the page reaches this as code: it reads three data attributes as strings and
 * compares them.
 */
/**
 * Reads the chosen answer and returns its baked URL, or null.
 *
 * Defined once and interpolated into BOTH submit handlers — FORM_ACTION_SCRIPT below for droppable
 * form blocks, and the opt-in form's own handler in renderPages.ts. Those two already duplicate the
 * collect-and-post logic; two copies of the routing decision as well is how one of them quietly
 * ends up resolving an answer differently from the other.
 *
 * Every string it can return was resolved server-side (afterSubmitAttrs / branchRulesHtml). This
 * picks between finished URLs; it never builds one.
 */
export const BRANCH_RESOLVE_JS = `window.aosBranchUrl = window.aosBranchUrl || function(form){
  var f = form.getAttribute('data-branch-field');
  if (!f) return null;
  var sel = (window.CSS && CSS.escape) ? CSS.escape(f) : f;
  var els = form.querySelectorAll('[name="' + sel + '"]'), v = '';
  for (var i = 0; i < els.length; i++) {
    var el = els[i];
    if (el.type === 'checkbox' || el.type === 'radio') { if (el.checked) { v = el.value || 'yes'; break; } }
    else { v = el.value; break; }
  }
  var rules = form.querySelectorAll('[data-branch-value]');
  for (var j = 0; j < rules.length; j++) {
    if (rules[j].getAttribute('data-branch-value') === v) return rules[j].getAttribute('data-branch-url') || null;
  }
  return form.getAttribute('data-branch-else-url') || null;
};`;

/**
 * Standalone tag, emitted ONLY beside a form whose action is actually a branch.
 *
 * It used to live inside FORM_ACTION_SCRIPT, which every form block emits — so a blog post with an
 * ordinary subscribe form shipped the routing resolver it can never use, and so did every funnel
 * form that doesn't branch. Assigned to `window` (rather than declared) so two branching forms on
 * one page define it once.
 */
const BRANCH_RESOLVE_SCRIPT = `<script>${BRANCH_RESOLVE_JS}</script>`;

const FORM_CONDITION_SCRIPT = `<script>(function(){
function val(form, key){
  var els = form.querySelectorAll('[name="' + CSS.escape(key) + '"]');
  if (!els.length) return null;
  var first = els[0];
  if (first.type === 'checkbox') return first.checked ? (first.value || 'yes') : '';
  if (first.type === 'radio') {
    for (var i = 0; i < els.length; i++) if (els[i].checked) return els[i].value;
    return '';
  }
  return first.value;
}
function apply(form){
  form.querySelectorAll('[data-when-field]').forEach(function(wrap){
    var v = val(form, wrap.getAttribute('data-when-field'));
    // A condition naming a field that is not on the page shows the dependent field rather than
    // hiding it forever — losing a question outright is the worse failure.
    var show = true;
    if (v !== null) {
      var op = wrap.getAttribute('data-when-op');
      var want = wrap.getAttribute('data-when-value') || '';
      if (op === 'equals') show = v === want;
      else if (op === 'not_equals') show = v !== want;
      else if (op === 'filled') show = v !== '';
      else if (op === 'empty') show = v === '';
    }
    wrap.hidden = !show;
    wrap.querySelectorAll('input,select,textarea').forEach(function(el){ el.disabled = !show; });
  });
}
// Bind by CONTENT, not by class. The standalone form block is <form class="aos-form"> while the
// locked opt-in form is <form id="leadForm"> — selecting on either class alone would silently skip
// the other, and the opt-in form is the one every funnel actually uses.
document.querySelectorAll('form').forEach(function(form){
  if (!form.querySelector('[data-when-field]')) return;
  form.addEventListener('input', function(){ apply(form); });
  form.addEventListener('change', function(){ apply(form); });
  apply(form);
});
})();</script>`;

const FORM_ACTION_SCRIPT = `<script>(function(){
if (window.__aosForms) return; window.__aosForms = 1;
document.addEventListener("click", function(e){
  var t = e.target && e.target.closest ? e.target.closest("[data-scroll-to],[data-open-form],[data-close-form]") : null;
  if (!t) return;
  var scroll = t.getAttribute("data-scroll-to");
  if (scroll) { var el = document.getElementById(scroll); if (el) el.scrollIntoView({behavior:"smooth",block:"start"}); return; }
  var open = t.getAttribute("data-open-form");
  if (open) { var f = document.getElementById(open); if (f) { f.hidden = false; f.classList.add("is-open"); } return; }
  if (t.getAttribute("data-close-form")) {
    var w = t.closest(".aos-form-popup"); if (w) { w.hidden = true; w.classList.remove("is-open"); }
  }
});
document.addEventListener("submit", function(e){
  var form = e.target;
  if (!form || !form.getAttribute || form.getAttribute("data-aos-form") !== "1") return;
  e.preventDefault();
  var extra = {}, first = "", email = "";
  form.querySelectorAll("[name]").forEach(function(el){
    var v = (el.type === "checkbox" || el.type === "radio") ? (el.checked ? (el.value || "yes") : "") : el.value;
    if (!v) return;
    if (el.name === "first_name") first = v; else if (el.name === "email") email = v; else extra[el.name] = v;
  });
  var done = form.querySelector(".aos-form-done");
  // What happens next is decided by data-after, written by afterSubmitAttrs(). "url" is already a
  // resolved, validated destination — the script never builds one. Anything it can't act on falls
  // through to the in-place message, so a form always visibly does SOMETHING on submit.
  function finish(){
    var after = form.getAttribute("data-after");
    if (after === "url") { var u = form.getAttribute("data-after-url"); if (u) { window.location.href = u; return; } }
    // Guarded: the resolver is only emitted beside a form that actually branches, so a throw here
    // would strand a visitor whose lead has already been saved.
    if (after === "branch" && window.aosBranchUrl) { var b = window.aosBranchUrl(form); if (b) { window.location.href = b; return; } }
    if (after === "popup") {
      var p = document.getElementById(form.getAttribute("data-after-id") || "");
      if (p) { p.hidden = false; p.classList.add("is-open"); }
    }
    form.querySelectorAll("input,select,textarea,button").forEach(function(el){ el.style.display="none"; });
    if (done) done.hidden = false;
  }
  fetch("/api/public/leads", {
    method: "POST", headers: {"Content-Type":"application/json"},
    body: JSON.stringify({ campaign_id: form.getAttribute("data-campaign"), first_name: first, email: email, extra_fields: extra })
  }).catch(function(){}).then(finish);
});
})();</script>`;

/**
 * One question at a time, with Next/Back.
 *
 * Delegated document-level listeners and a re-scan on click, NOT COUNTDOWN_SCRIPT's one-shot
 * querySelectorAll: a form block can be `popup: true`, so it may be revealed long after parse, and
 * a one-shot scan would leave it showing every question at once.
 *
 * DEGRADES OPEN. The server renders every question visible and marks nothing hidden; this script is
 * what collapses them to one at a time. So with JS off, or before this runs, the page is a normal
 * long form that submits correctly — rather than a blank card, which is what hiding server-side and
 * revealing client-side would produce on the one page kind that is paid for by the click.
 */
const FORM_STEPPED_SCRIPT = `<script>(function(){
if (window.__aosStepped) return; window.__aosStepped = 1;
function groups(form){ return form.querySelectorAll(".aos-step"); }
function show(form, i){
  var g = groups(form); if (!g.length) return;
  var n = Math.max(0, Math.min(g.length - 1, i));
  for (var k = 0; k < g.length; k++) g[k].hidden = (k !== n);
  form.setAttribute("data-step", String(n));
  var back = form.querySelector(".aos-step-back"), next = form.querySelector(".aos-step-next");
  var submit = form.querySelector('button[type="submit"]');
  if (back) back.hidden = n === 0;
  // The submit button only appears on the last question, so Enter can't post a half-finished quiz.
  if (next) next.hidden = n >= g.length - 1;
  if (submit) submit.hidden = n < g.length - 1;
}
function setup(form){
  if (form.getAttribute("data-stepped-ready") === "1") return;
  if (!groups(form).length) return;
  form.setAttribute("data-stepped-ready", "1");
  // The nav is rendered hidden and revealed here, so with JS off the page is a plain long form
  // with a working submit rather than one carrying two buttons that do nothing.
  var nav = form.querySelector(".aos-step-nav"); if (nav) nav.hidden = false;
  show(form, 0);
}
document.addEventListener("click", function(e){
  var t = e.target && e.target.closest ? e.target.closest(".aos-step-next,.aos-step-back") : null;
  if (!t) return;
  var form = t.closest("form"); if (!form) return;
  e.preventDefault();
  setup(form);
  var cur = Number(form.getAttribute("data-step") || 0);
  show(form, cur + (t.classList.contains("aos-step-next") ? 1 : -1));
});
document.querySelectorAll("form").forEach(setup);
})();</script>`;

const COUNTDOWN_SCRIPT = `<script>(function(){
if (window.__aosCountdown) return; window.__aosCountdown = 1;
function pad(n){return (n<10?"0":"")+n;}
function start(el){
  var until;
  if (el.dataset.mode === "date") { until = Number(el.dataset.until); }
  else {
    var key = "aos_cd_" + el.id, saved = null;
    try { saved = localStorage.getItem(key); } catch (e) {}
    until = saved ? Number(saved) : Date.now() + Number(el.dataset.minutes) * 60000;
    if (!saved) { try { localStorage.setItem(key, String(until)); } catch (e) {} }
  }
  var clock = el.querySelector(".cd-clock"), expired = el.querySelector(".cd-expired");
  function tick(){
    var ms = until - Date.now();
    if (!(ms > 0)) {
      clock.hidden = true; expired.hidden = false;
      var lbl = el.querySelector(".cd-label"); if (lbl) lbl.hidden = true;
      clearInterval(timer); return;
    }
    var s = Math.floor(ms/1000), d = Math.floor(s/86400);
    clock.textContent = (d > 0 ? d + "d " : "") + pad(Math.floor(s/3600)%24) + ":" + pad(Math.floor(s/60)%60) + ":" + pad(s%60);
  }
  var timer = setInterval(tick, 1000); tick();
}
document.querySelectorAll(".countdown").forEach(start);
})();</script>`;

function renderColumn(col: ColumnBlock, ctx: RenderCtx): string {
  return `<div class="col"${styleAttr(col.style, BOX_STYLE_KEYS)}>${col.children
    .map((c) => withVisibility(renderElement(c, ctx), c))
    .join("\n")}</div>`;
}

function renderRow(row: RowBlock, ctx: RenderCtx): string {
  return `<div class="row"${styleAttr(row.style, BOX_STYLE_KEYS)}>${row.columns
    .map((c) => withVisibility(renderColumn(c, ctx), c))
    .join("\n")}</div>`;
}

function renderSection(section: SectionBlock, ctx: RenderCtx): string {
  // The id is what a scroll action lands on. Without it `getElementById` found nothing, so a
  // "scroll to this section" button — offered by the settings panel since actions shipped — did
  // nothing at all on the published page. Ids are ID_RE-validated, and an id attribute changes
  // nothing visually, so this is safe to add to pages already serving traffic.
  return `<div class="section" id="${escapeHtml(section.id)}"${styleAttr(section.style, BOX_STYLE_KEYS)}>${section.children
    .map((c) => withVisibility(c.type === "row" ? renderRow(c, ctx) : renderElement(c, ctx), c))
    .join("\n")}</div>`;
}

// LEAD_CAPTURE_ENDPOINT: posts to /api/public/leads. The fixed name/email inputs and the POST
// wiring below are rendered by this function only — never exposed as editable fields in the
// editor, so they can't be redirected or removed via the block-tree builder.
// One tenant-added field. Every branch emits a `name` matching the block's fieldKey, because that
// is what the submit handler collects and what the leads route validates against the page's
// current field list — a field rendered without it silently never reaches the database.
/**
 * The wrapper a field needs once it can carry a label or a condition.
 *
 * Emitted ONLY when one of those is set. A plain field still renders as a bare input exactly as
 * before, so no stored page gains a wrapper div (and the CSS that targets `.aos-form input` as a
 * direct child keeps matching) until someone opts in.
 */
function wrapField(f: FormInputBlock, inner: string, halfClass: boolean): string {
  const pos = f.content.labelPosition ?? "none";
  const cond = f.content.visibleWhen;
  if (pos === "none" && !cond) return inner;

  const label = escapeHtml(f.content.label);
  const cls = ["fld", halfClass ? "fld-half" : "", pos === "border" ? "fld-lbl-border" : "", pos === "above" ? "fld-lbl-above" : ""]
    .filter(Boolean)
    .join(" ");

  // Only the three parts of a condition, each escaped, ever reach the DOM — the page's own script
  // reads them as data, never as code. Same rule the countdown block follows.
  const condAttrs = cond
    ? ` data-when-field="${escapeHtml(cond.fieldKey)}" data-when-op="${escapeHtml(cond.op)}"${
        cond.value !== undefined ? ` data-when-value="${escapeHtml(cond.value)}"` : ""
      }`
    : "";

  const labelHtml = pos === "none" ? "" : `<span class="fld-label">${label}</span>`;
  return `<div class="${cls}"${condAttrs}>${labelHtml}${inner}</div>`;
}

function renderFormField(f: FormInputBlock): string {
  const name = escapeHtml(f.content.fieldKey);
  const label = escapeHtml(f.content.label);
  const placeholder = escapeHtml(f.content.placeholder || f.content.label);
  const required = f.content.required ? " required" : "";
  const options = (f.content.options ?? []).filter((o) => o.trim() !== "");
  // Half-width fields sit side by side (two consecutive halves make a row) — the layout control
  // people actually want on a form, without a nested row/column model inside the form itself.
  // When the field gains a wrapper the class moves OUT to it, or the grid would size the input
  // rather than the labelled group.
  const wrapped = (f.content.labelPosition ?? "none") !== "none" || !!f.content.visibleWhen;
  const half = f.content.width === "half" && !wrapped ? ' class="fld-half"' : "";

  const out = (inner: string) => wrapField(f, inner, f.content.width === "half");

  switch (f.content.fieldType) {
    case "textarea":
      return out(`<textarea name="${name}"${half} placeholder="${placeholder}" rows="4"${required}></textarea>`);

    case "checkbox":
      // Value is only submitted when ticked, which is exactly the semantics a checkbox should
      // have — an unticked box sends nothing rather than "false".
      return out(`<label class="field-check"><input type="checkbox" name="${name}" value="yes"${required} /> <span>${label}</span></label>`);

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
      return out(`<fieldset class="field-group"><legend>${label}</legend>${inputs}</fieldset>`);
    }

    case "select": {
      if (options.length === 0) return "";
      const opts = options
        .map((o) => `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`)
        .join("");
      // The placeholder option carries no value, so "nothing chosen" fails a required check
      // instead of submitting the prompt text as an answer.
      return out(`<select name="${name}"${half}${required}><option value="">${placeholder}</option>${opts}</select>`);
    }

    default:
      return out(`<input name="${name}"${half} type="${f.content.fieldType}" placeholder="${placeholder}"${required} />`);
  }
}

/**
 * The `data-after-*` attributes both form renderers emit, and the single place a FormSubmitAction
 * becomes markup.
 *
 * `offer` is resolved to a real URL HERE rather than in the browser: the funnel chain still wins
 * when the funnel has steps (which is what the old data-next-step-url did), and otherwise it is
 * the hoplink. Resolving server-side keeps the client script a dumb switch over attributes and
 * means an offer link is never something page content could influence.
 *
 * A form whose action can't resolve to anything (an `offer` on a page with no campaign, a `url`
 * left blank) degrades to `message` — a form that saves and then appears to do nothing is the
 * worst outcome here, and it's the one the [object Object] bug actually produced.
 */
/**
 * Does this tree contain a form ANYWHERE — the locked opt-in one at root, or a droppable `form`
 * block nested in a section, row or column?
 *
 * Recursive on purpose. The root-level `lead_capture_form` check this replaced missed a standalone
 * form dropped into a section, so such a page kept its primary_cta and rendered two buttons — the
 * exact duplicate this was supposed to remove, just one level down.
 */
export function treeHasForm(blocks: unknown[]): boolean {
  for (const raw of blocks) {
    const b = raw as { type?: string; locked?: string; children?: unknown[]; columns?: unknown[] } | null;
    if (!b || typeof b !== "object") continue;
    if (b.locked === "lead_capture_form" || b.type === "form") return true;
    if (Array.isArray(b.children) && treeHasForm(b.children)) return true;
    if (Array.isArray(b.columns) && treeHasForm(b.columns)) return true;
  }
  return false;
}

/**
 * One answer's destination, resolved to a real URL HERE, at bake time. Returns null for "stay on
 * the page and show the success message".
 *
 * Everything the client script ever sees is the output of this function. That is the same
 * invariant `{kind:"offer"}` has always had — the tenant never types the hoplink — extended to
 * per-answer routing: the script picks between finished URLs, it never builds one.
 */
function resolveBranchTarget(t: BranchTarget, ctx: RenderCtx): string | null {
  switch (t.kind) {
    case "offer":
      return ctx.nextStepUrl || ctx.primaryHref || null;
    case "url":
      return t.href || null;
    case "step":
      // Absent id -> null -> the caller falls back to `otherwise`. A funnel whose steps were
      // deleted must land somewhere, not on a dead link.
      return (ctx.steps ?? []).find((s) => s.id === t.stepId)?.url ?? null;
    default:
      return null;
  }
}

/**
 * The rule table, as inert hidden elements inside the form. One per answer, each carrying the
 * answer value and its already-resolved URL.
 *
 * Elements rather than a JSON blob on purpose: a JSON attribute would have to be parsed by the
 * script, which is a step away from the script making decisions, and it would put a tenant-authored
 * string through JSON.parse. escapeHtml covers `& < > "`, so a double-quoted attribute cannot be
 * broken out of — keep these quotes double.
 */
function branchRulesHtml(action: FormSubmitAction | undefined, ctx: RenderCtx): string {
  if (!action || action.kind !== "branch") return "";
  return action.rules
    .map((r) => {
      const url = resolveBranchTarget(r.then, ctx);
      return `<span class="aos-branch" hidden data-branch-value="${escapeHtml(r.value)}"${
        url ? ` data-branch-url="${escapeHtml(url)}"` : ""
      }></span>`;
    })
    .join("");
}

/**
 * Wraps each already-rendered field in its own step, and appends the Back/Next nav.
 *
 * Nothing is `hidden` here except the nav — see FORM_STEPPED_SCRIPT for why the collapse to one
 * question at a time is the script's job, not the server's.
 *
 * Shared by both form renderers so the class names the script looks for are written once.
 */
function steppedBody(parts: string[]): string {
  const steps = parts.filter(Boolean).map((p) => `<div class="aos-step">${p}</div>`).join("");
  return `${steps}<div class="aos-step-nav" hidden><button type="button" class="aos-step-back" hidden>Back</button><button type="button" class="aos-step-next">Next</button></div>`;
}

export function afterSubmitAttrs(
  action: FormSubmitAction | undefined,
  ctx: RenderCtx,
  fallback: FormSubmitAction["kind"]
): string {
  const a: FormSubmitAction = action ?? ({ kind: fallback } as FormSubmitAction);
  switch (a.kind) {
    case "offer": {
      const href = ctx.nextStepUrl || ctx.primaryHref || "";
      return href ? ` data-after="url" data-after-url="${escapeHtml(href)}"` : ` data-after="message"`;
    }
    case "url":
      return a.href ? ` data-after="url" data-after-url="${escapeHtml(a.href)}"` : ` data-after="message"`;
    case "popup":
      return a.formId ? ` data-after="popup" data-after-id="${escapeHtml(a.formId)}"` : ` data-after="message"`;
    case "branch": {
      // The rules themselves live in the form body (branchRulesHtml); this carries which field to
      // read and where an unmatched answer goes. An `otherwise` that resolves to nothing simply
      // omits the attribute, and the script shows the success message — the same end state as
      // every other unresolvable action here.
      const other = resolveBranchTarget(a.otherwise, ctx);
      return ` data-after="branch" data-branch-field="${escapeHtml(a.fieldKey)}"${
        other ? ` data-branch-else-url="${escapeHtml(other)}"` : ""
      }`;
    }
    default:
      return ` data-after="message"`;
  }
}

function renderLeadCaptureForm(block: LeadCaptureFormBlock, ctx: RenderCtx): string {
  const extraFields = (block.children ?? []).map(renderFormField).filter(Boolean);
  // Never tree nodes — there is no tree state that could represent "email field deleted".
  const contactInputs = `<input id="leadFirstName" name="first_name" type="text" placeholder="First name" required />
          <input id="leadEmail" name="email" type="email" placeholder="Email address" required />`;
  // Stepped puts the CONTACT details last: a survey asks its questions and then asks who you are,
  // which is also the order that gets them answered. Unstepped keeps the original DOM order exactly,
  // so no stored page moves.
  const formBody = block.content.stepped
    ? steppedBody([...extraFields, contactInputs])
    : `${contactInputs}
          ${extraFields.join("\n          ")}`;
  const done = escapeHtml(block.content.successText || "Thanks — check your inbox.");
  return `<div class="optin"${styleAttr(block.style, FORM_STYLE_KEYS)}>
        <form id="leadForm" data-campaign-id="${escapeHtml(ctx.campaignId)}"${afterSubmitAttrs(
    block.content.afterSubmit,
    ctx,
    "offer"
  )}>
          ${formBody}${branchRulesHtml(block.content.afterSubmit, ctx)}
          <button type="submit" class="cta">${escapeHtml(block.content.ctaText)}</button>
          <p class="disclosure">${ctx.leadConsentText}</p>
        </form>
        <p class="aos-form-done reveal" hidden>${done}</p>
      </div>${block.children.some((f) => f.content.visibleWhen) ? FORM_CONDITION_SCRIPT : ""}${
    block.content.stepped ? FORM_STEPPED_SCRIPT : ""
  }`;
  // NOTE: the opt-in form does NOT emit BRANCH_RESOLVE_SCRIPT — its submit handler lives in the
  // page shell (renderPages.ts), which emits the resolver itself when the body contains a branch.
}

function renderLockedBlock(block: LockedBlock, ctx: RenderCtx): string {
  switch (block.locked) {
    case "disclosure":
      return `<p class="disclosure"${styleAttr(block.style, TEXT_STYLE_KEYS)}>${ctx.disclosureText}</p>`;
    case "lead_capture_form":
      return renderLeadCaptureForm(block, ctx);
    case "primary_cta": {
      // An opt-in page that HAS a form doesn't render this at all any more: the form's own
      // afterSubmit action carries the destination, so a separate hidden-until-submit button was
      // a second button that only ever duplicated the first. Kept — and still the page's only
      // way out — when there is NO form, and on funnel steps, which have no form by design.
      if (ctx.pageKind === "bridge" && ctx.hasForm) return "";
      return `<a class="cta" href="${escapeHtml(ctx.primaryHref)}"${styleAttr(
        block.style,
        BUTTON_STYLE_KEYS
      )}>${escapeHtml(block.content.text)}</a>`;
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
  // Derived here rather than asked of the caller: the tree is the only thing that knows, and a
  // caller passing it separately could disagree with what actually rendered.
  const ctxWithForm: RenderCtx = {
    ...ctx,
    hasForm: treeHasForm(tree.blocks),
  };
  return [...rest, ...disclosure]
    .map((b) =>
      withVisibility(b.type === "section" ? renderSection(b, ctxWithForm) : renderLockedBlock(b, ctxWithForm), b)
    )
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

/**
 * Sets a block's responsive visibility. Mirrors updateBlockStyle rather than routing through it —
 * `hidden` is not a style key (it becomes a class, not an inline declaration) and giving it its
 * own setter keeps that distinction visible at every call site.
 *
 * An empty list removes the key entirely instead of storing `[]`, so a block that shows everywhere
 * looks in the stored JSON exactly like one saved before this existed.
 */
export function updateBlockHidden(tree: PageBlockTree, blockId: string, hidden: Viewport[]): PageBlockTree {
  return {
    ...tree,
    blocks: tree.blocks.map((b) =>
      walkAndUpdate(b, blockId, (node) => {
        const next: any = { ...node };
        if (hidden.length) next.hidden = hidden;
        else delete next.hidden;
        return next;
      })
    ),
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
    case "progress":
      return { label: "Your progress", percent: 60, caption: "" };
    case "navigation":
      // Seeded with the brand line and no links: which sections exist is the next decision, and a
      // nav pointing at ids that aren't on the page yet would render dead buttons.
      return { brand: "Your brand", brandImageDataUrl: null, links: [], sticky: false };
    case "icon":
      return { name: ALLOWED_ICON_NAMES[0], size: 40, label: "" };
    case "footer":
      // Seeded with the two links a page taking paid traffic is most often asked for, left EMPTY
      // rather than pointing at invented URLs — a footer link to a page that doesn't exist is
      // worse than no link, and the empty href is filtered out at render until it's filled in.
      return {
        text: `© ${new Date().getFullYear()} Your business name. All rights reserved.`,
        links: [
          { label: "Privacy policy", href: "" },
          { label: "Terms", href: "" },
        ],
      };
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
      return { text: "Click here", action: { kind: "link", href: "https://example.com" } };
    case "video":
      // No source: an empty block renders nothing rather than a placeholder, so a half-finished
      // page never ships a broken player to real traffic.
      return { source: null, title: "" };
    case "faq_item":
      return { question: "New question", answer: "Answer" };
    case "carousel":
      return { slides: [{ imageDataUrl: null, caption: "" }, { imageDataUrl: null, caption: "" }] };
    case "form":
      return { title: "", submitText: "Send", successText: "Thanks — we'll be in touch.", popup: false };
    case "countdown":
      // Evergreen by default: a date-mode block with no deadline yet would render nothing, and a
      // block that vanishes the moment you insert it reads as broken.
      return { mode: "evergreen", deadline: null, minutes: 15, label: "This offer ends in", expiredText: "This offer has ended." };
    case "custom_html":
      // Empty, not a sample snippet: seeded markup would publish on a page whose author only meant
      // to try the block, and this is the one block whose default content actually runs.
      return { code: "" };
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
  // `form` is the one element type that is ALSO a container (children: FormInputBlock[]), so it
  // needs its array seeded here — every other element is content-only. Without this the block is
  // inserted with children === undefined and the very next render throws on `.map`, which took
  // the whole editor down (PageEditor calls renderBlockTree on every render to score SEO).
  const block: ElementBlock = {
    id: newBlockId(),
    type,
    style: {},
    content: defaultElementContent(type),
    ...(type === "form" ? { children: [] } : {}),
  } as ElementBlock;
  const clamped = Math.max(0, Math.min(index, items.length));
  return withContainer(tree, ref, [...items.slice(0, clamped), block, ...items.slice(clamped)]);
}

/**
 * Adds an Input, creating the form it needs if the page hasn't got one.
 *
 * The palette offers Input, not Form: something still has to POST, but which container that is
 * isn't a decision worth making every time you want to collect a phone number. So — append to the
 * LAST form already on the page (the locked opt-in form counts, so a funnel page's inputs land
 * where the leads already go), else wrap a new form around the first one.
 *
 * "Last" rather than "nearest to the selection" on purpose: a page reads top to bottom, the form
 * is normally at the end of it, and a rule you can state in one sentence beats one that's
 * marginally smarter and unpredictable.
 */
export function insertFormInput(tree: PageBlockTree, ref: ContainerRef, index: number): PageBlockTree {
  const field: FormInputBlock = {
    id: newBlockId(),
    type: "form_input",
    style: {},
    content: { label: "Last name", fieldKey: "last_name", fieldType: "text", placeholder: "Last name", required: false },
  };

  let target: string | null = null;
  const visit = (b: any) => {
    if (b?.type === "form" || b?.locked === "lead_capture_form") target = b.id as string;
    for (const k of ["children", "columns"]) {
      const kids = b?.[k];
      if (Array.isArray(kids)) kids.forEach(visit);
    }
  };
  tree.blocks.forEach(visit);

  if (target) {
    // Field keys are the CSV headers, so a second "Last name" must not silently overwrite the
    // first — uniqueFieldKey is the editor's job for presets, and this is the same guarantee for
    // the default one.
    const used = new Set<string>();
    const collect = (b: any) => {
      if (b?.type === "form_input") used.add(b.content?.fieldKey);
      for (const k of ["children", "columns"]) {
        const kids = b?.[k];
        if (Array.isArray(kids)) kids.forEach(collect);
      }
    };
    tree.blocks.forEach(collect);
    if (used.has(field.content.fieldKey)) {
      let n = 2;
      while (used.has(`${field.content.fieldKey}_${n}`)) n++;
      field.content.fieldKey = `${field.content.fieldKey}_${n}`;
    }
    return { ...tree, blocks: tree.blocks.map((b) => addChildTo(b, target!, field)) };
  }

  if (ref.kind === "root") return tree;
  const items = getContainer(tree, ref);
  if (!items) return tree;
  const form: ElementBlock = {
    id: newBlockId(),
    type: "form",
    style: {},
    content: { title: "", submitText: "Send", successText: "Thanks — we'll be in touch.", popup: false },
    children: [field],
  } as ElementBlock;
  const clamped = Math.max(0, Math.min(index, items.length));
  return withContainer(tree, ref, [...items.slice(0, clamped), form, ...items.slice(clamped)]);
}

/** Appends `child` to whichever descendant of `node` has id === parentId. */
function addChildTo(node: any, parentId: string, child: any): any {
  if (node?.id === parentId) return { ...node, children: [...(node.children ?? []), child] };
  const out = { ...node };
  for (const k of ["children", "columns"] as const) {
    if (Array.isArray(node?.[k])) out[k] = node[k].map((c: any) => addChildTo(c, parentId, child));
  }
  return out;
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

/**
 * Inserts a new, empty Section at a root position.
 *
 * Empty on purpose rather than pre-filled with a heading: a Section is a band of the page, and
 * what goes in it is the next decision, not one this helper should make. `SectionBody` renders a
 * drop zone and its own "+ Add block" menu for an empty one, so it is immediately usable.
 *
 * Root-only, matching `moveBlockToContainer`'s own rule that a Section can never nest.
 */
export function insertSection(tree: PageBlockTree, index: number): PageBlockTree {
  const section: SectionBlock = { id: newBlockId(), type: "section", style: {}, children: [] };
  const clamped = Math.max(0, Math.min(index, tree.blocks.length));
  return { ...tree, blocks: [...tree.blocks.slice(0, clamped), section, ...tree.blocks.slice(clamped)] };
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
