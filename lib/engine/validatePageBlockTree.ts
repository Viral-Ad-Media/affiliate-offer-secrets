// The real security boundary for the block-tree page model (Phase O) — consumed by all three
// page-copy PATCH routes (replacing their old flat clamp/validate logic entirely) and by
// app/api/public/leads/route.ts (via extractLeadFormFields, Phase O.5) to know which extra form
// fields are currently legitimate for a given page. Mirrors this codebase's established
// "clamp/tolerate a too-long value, hard-reject a structurally wrong shape" split: a headline
// that's too long gets truncated (same UX as every prior editor route in this app); a forged
// block type, a locked block in the wrong place, or a tree past the depth/count caps gets a
// straight 400 — those only happen via a client bypassing the UI entirely, never normal use.

import {
  ELEMENT_BLOCK_TYPES,
  ALLOWED_ICON_NAMES,
  FORM_FIELD_TYPES,
  CHOICE_FIELD_TYPES,
  type FormFieldType,
  type PageBlockTree,
  type SectionBlock,
  type RowBlock,
  type ColumnBlock,
  type ElementBlock,
  type LockedBlock,
  type FormInputBlock,
  type BlockStyle,
  type BlockType,
  type FunnelStepType,
  TESTIMONIAL_MEDIA_KINDS,
  contentWidthOf,
  treeHasForm,
  type ButtonAction,
  type FormSubmitAction,
  type TestimonialMedia,
  VIEWPORTS,
  type Viewport,
} from "./blockTree";
import { isValidImageDataUrl } from "@/lib/images/validate";
import { parseVideoUrl, sourceToDisplayUrl } from "@/lib/engine/videoEmbed";
import { isValidRedirectUrl } from "@/lib/validate";
import { sanitizeTheme } from "./pageTheme";

export type PageKind = "bridge" | "funnel_step" | "blog";
export type ValidatePageBlockTreeOptions = { pageKind: PageKind; stepType?: FunnelStepType };
export type ValidationResult = { ok: true; tree: PageBlockTree } | { ok: false; error: string };

const MAX_TEXT_SHORT = 200; // headline, subheading, faq question, form label
const MAX_TEXT_MEDIUM = 1000; // paragraph, faq answer, icon/image-list item text
const MAX_TEXT_LONG = 3000; // "mechanism"-length paragraphs
const MAX_CTA = 60;
const MAX_LIST_ITEMS = 10;
const MAX_TOTAL_BLOCKS = 300;
const MAX_DEPTH = 4; // root(section) -> row -> column -> element
const MAX_SECTION_CHILDREN = 60;
const MAX_COLUMN_CHILDREN = 20;
const MAX_FORM_CHILDREN = 10;
const MAX_FIELD_OPTIONS = 12; // radio/select choices — a lead form asking for more than this is a survey
const MAX_ROOT_BLOCKS = 40;

const HEX_RE = /^#[0-9a-f]{6}$/i;
const ID_RE = /^[a-zA-Z0-9_-]{1,100}$/;
const FIELD_KEY_RE = /^[a-z0-9_-]{1,60}$/;
const FONT_FAMILIES = new Set(["system", "serif", "mono"]);
const FONT_WEIGHTS = new Set([400, 500, 600, 700, 800]);
const TEXT_ALIGNS = new Set(["left", "center", "right"]);

class BlockCountLimit extends Error {}

function clampStr(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  return v.slice(0, max).trim();
}

function isValidId(v: unknown): v is string {
  return typeof v === "string" && ID_RE.test(v);
}

// Every stored style value passes through here before ever reaching this same object again at
// render time (styleToInlineCss in blockTree.ts) — belt-and-suspenders, matching this codebase's
// established habit of not trusting a single validation layer for anything rendered into real
// HTML served to real visitors.
function sanitizeStyle(raw: unknown): BlockStyle {
  const s = (raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {}) as Record<string, unknown>;
  const style: BlockStyle = {};
  const num = (v: unknown, min: number, max: number): number | undefined => {
    const n = typeof v === "number" ? v : NaN;
    return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : undefined;
  };
  const hex = (v: unknown): string | undefined => (typeof v === "string" && HEX_RE.test(v) ? v.toLowerCase() : undefined);

  if (typeof s.fontFamily === "string" && FONT_FAMILIES.has(s.fontFamily)) style.fontFamily = s.fontFamily as BlockStyle["fontFamily"];
  const fs = num(s.fontSize, 8, 96);
  if (fs !== undefined) style.fontSize = fs;
  if (typeof s.fontWeight === "number" && FONT_WEIGHTS.has(s.fontWeight)) style.fontWeight = s.fontWeight as BlockStyle["fontWeight"];
  if (typeof s.textAlign === "string" && TEXT_ALIGNS.has(s.textAlign)) style.textAlign = s.textAlign as BlockStyle["textAlign"];
  const color = hex(s.color);
  if (color) style.color = color;
  if (typeof s.lineHeight === "number" && s.lineHeight >= 1 && s.lineHeight <= 2.5) style.lineHeight = s.lineHeight;
  const bg = hex(s.backgroundColor);
  if (bg) style.backgroundColor = bg;
  for (const k of ["paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "marginTop", "marginBottom"] as const) {
    const v = num(s[k], 0, 200);
    if (v !== undefined) style[k] = v;
  }
  const bw = num(s.borderWidth, 0, 16);
  if (bw !== undefined) style.borderWidth = bw;
  const bc = hex(s.borderColor);
  if (bc) style.borderColor = bc;
  const br = num(s.borderRadius, 0, 64);
  if (br !== undefined) style.borderRadius = br;
  const mw = num(s.maxWidth, 100, 1200);
  if (mw !== undefined) style.maxWidth = mw;

  // Block layout + form-field look. This function REBUILDS the style object rather than filtering
  // it, so a key missing here is silently dropped on every save — the same trap contentWidth hit.
  if (s.width === "auto" || s.width === "full") style.width = s.width;
  if (typeof s.align === "string" && TEXT_ALIGNS.has(s.align)) style.align = s.align as BlockStyle["align"];
  const fbg = hex(s.fieldBackgroundColor);
  if (fbg) style.fieldBackgroundColor = fbg;
  const ffg = hex(s.fieldTextColor);
  if (ffg) style.fieldTextColor = ffg;
  const fbc = hex(s.fieldBorderColor);
  if (fbc) style.fieldBorderColor = fbc;
  const fbw = num(s.fieldBorderWidth, 0, 8);
  if (fbw !== undefined) style.fieldBorderWidth = fbw;
  const fbr = num(s.fieldBorderRadius, 0, 40);
  if (fbr !== undefined) style.fieldBorderRadius = fbr;
  const fg = num(s.fieldGap, 0, 40);
  if (fg !== undefined) style.fieldGap = fg;
  return style;
}

function validateElementInner(raw: unknown, count: { n: number }): ElementBlock {
  if (++count.n > MAX_TOTAL_BLOCKS) throw new BlockCountLimit("too many blocks");
  const b = (raw ?? {}) as Record<string, unknown>;
  if (!isValidId(b.id)) throw new Error("invalid block id");
  const type = b.type;
  if (typeof type !== "string" || !(ELEMENT_BLOCK_TYPES as readonly string[]).includes(type)) {
    throw new Error(`unknown element block type: ${String(type)}`);
  }
  const id = b.id as string;
  const style = sanitizeStyle(b.style);
  const content = (b.content ?? {}) as Record<string, unknown>;

  switch (type as BlockType) {
    case "heading":
    case "subheading":
      return { id, type: type as "heading" | "subheading", style, content: { text: clampStr(content.text, MAX_TEXT_SHORT) } };
    case "paragraph":
      return { id, type: "paragraph", style, content: { text: clampStr(content.text, MAX_TEXT_LONG) } };
    case "image": {
      const dataUrl = typeof content.dataUrl === "string" && content.dataUrl ? content.dataUrl : null;
      if (dataUrl && !isValidImageDataUrl(dataUrl)) throw new Error("invalid image data url");
      return { id, type: "image", style, content: { dataUrl, alt: clampStr(content.alt, MAX_TEXT_SHORT) } };
    }
    case "bullet_list": {
      const items = Array.isArray(content.items) ? content.items : [];
      return {
        id,
        type: "bullet_list",
        style,
        content: { items: items.slice(0, MAX_LIST_ITEMS).map((i) => clampStr(i, MAX_TEXT_MEDIUM)).filter(Boolean) },
      };
    }
    case "icon_list": {
      const items = Array.isArray(content.items) ? content.items : [];
      return {
        id,
        type: "icon_list",
        style,
        content: {
          items: items.slice(0, MAX_LIST_ITEMS).map((raw) => {
            const it = (raw ?? {}) as Record<string, unknown>;
            const icon = typeof it.icon === "string" && ALLOWED_ICON_NAMES.includes(it.icon) ? it.icon : ALLOWED_ICON_NAMES[0];
            return { icon, text: clampStr(it.text, MAX_TEXT_MEDIUM) };
          }),
        },
      };
    }
    case "divider":
      return { id, type: "divider", style, content: {} };
    case "image_list": {
      const items = Array.isArray(content.items) ? content.items : [];
      return {
        id,
        type: "image_list",
        style,
        content: {
          items: items.slice(0, MAX_LIST_ITEMS).map((raw) => {
            const it = (raw ?? {}) as Record<string, unknown>;
            const dataUrl = typeof it.imageDataUrl === "string" && it.imageDataUrl ? it.imageDataUrl : null;
            if (dataUrl && !isValidImageDataUrl(dataUrl)) throw new Error("invalid image data url");
            return { imageDataUrl: dataUrl, caption: clampStr(it.caption, MAX_TEXT_MEDIUM) };
          }),
        },
      };
    }
    case "button": {
      const text = clampStr(content.text, MAX_CTA);
      const raw = (content.action ?? null) as { kind?: unknown; href?: unknown; targetId?: unknown; formId?: unknown } | null;
      // Pages saved before actions existed carry a bare href — promoted to {kind:"link"} here
      // rather than migrated, same permanent-adapter habit as PageCopy.
      const kind = raw && typeof raw === "object" && typeof raw.kind === "string" ? raw.kind : "link";

      let action: ButtonAction;
      if (kind === "scroll" || kind === "popup") {
        // Ids only — never a URL. An id that names nothing on the page is harmless (the script
        // looks it up and finds nothing), so this clamps rather than rejecting: a block can be
        // deleted after a button was pointed at it, and that shouldn't block saving the page.
        const target = clampStr(kind === "scroll" ? raw?.targetId : raw?.formId, 100);
        if (!ID_RE.test(target)) throw new Error(`invalid button ${kind} target`);
        action = kind === "scroll" ? { kind: "scroll", targetId: target } : { kind: "popup", formId: target };
      } else if (kind === "submit") {
        action = { kind: "submit" };
      } else {
        const href = clampStr(raw?.href ?? content.href, 2000);
        if (!isValidRedirectUrl(href)) throw new Error("invalid button href");
        action = { kind: "link", href };
      }
      return { id, type: "button", style, content: { text, action } };
    }
    case "form": {
      const kids = Array.isArray((b as Record<string, unknown>).children) ? ((b as any).children as unknown[]) : [];
      return {
        id,
        type: "form",
        style,
        content: {
          title: clampStr(content.title, MAX_TEXT_SHORT),
          submitText: clampStr(content.submitText, MAX_CTA) || "Send",
          successText: clampStr(content.successText, MAX_TEXT_SHORT) || "Thanks.",
          popup: content.popup === true,
          // Absent = message, which is exactly what this form did before actions existed.
          afterSubmit: validateFormSubmitAction(content.afterSubmit, { kind: "message" }),
        },
        // Same cap and same per-field validation as the locked opt-in form — one definition of
        // what a form field may be, so a standalone form can't accept anything the other can't.
        children: kids.slice(0, MAX_FORM_CHILDREN).map((f) => validateFormInput(f, count)),
      };
    }
    case "video": {
      // The stored shape is re-parsed, never trusted. A row could carry a hand-edited source (or
      // one written before a rule tightened), so the server decides again from the display URL
      // exactly as it did on first save — and an unparseable one becomes null, which renders
      // nothing, rather than an error that would block saving the rest of the page.
      const raw = (content.source ?? null) as { provider?: unknown; videoId?: unknown; url?: unknown } | null;
      const candidate =
        raw && typeof raw === "object"
          ? sourceToDisplayUrl({
              provider: raw.provider,
              videoId: typeof raw.videoId === "string" ? raw.videoId : "",
              url: typeof raw.url === "string" ? raw.url : "",
            } as any)
          : "";
      return {
        id,
        type: "video",
        style,
        content: { source: parseVideoUrl(candidate), title: clampStr(content.title, MAX_TEXT_SHORT) },
      };
    }
    case "carousel": {
      const raw = Array.isArray(content.slides) ? content.slides : [];
      return {
        id,
        type: "carousel",
        style,
        content: {
          slides: raw.slice(0, MAX_LIST_ITEMS).map((r) => {
            const it = (r ?? {}) as Record<string, unknown>;
            const dataUrl = typeof it.imageDataUrl === "string" && it.imageDataUrl ? it.imageDataUrl : null;
            // Same allowlist and same throw as every other image in this codebase.
            if (dataUrl && !isValidImageDataUrl(dataUrl)) throw new Error("invalid image data url");
            return { imageDataUrl: dataUrl, caption: clampStr(it.caption, MAX_TEXT_MEDIUM) };
          }),
        },
      };
    }
    case "countdown": {
      const mode = content.mode === "date" ? "date" : "evergreen";
      // Re-parsed, never stored as typed: only a real instant survives, and it is re-serialised
      // from Date so a hand-edited row can't smuggle anything into the data attribute.
      const parsed = typeof content.deadline === "string" ? Date.parse(content.deadline) : NaN;
      return {
        id,
        type: "countdown",
        style,
        content: {
          mode,
          deadline: Number.isFinite(parsed) ? new Date(parsed).toISOString() : null,
          // 1 minute to 7 days. An "evergreen" window longer than that isn't urgency, it's a lie
          // with extra steps.
          minutes: Math.min(10080, Math.max(1, Math.round(Number(content.minutes) || 15))),
          label: clampStr(content.label, MAX_TEXT_SHORT),
          expiredText: clampStr(content.expiredText, MAX_TEXT_SHORT),
        },
      };
    }
    case "testimonial": {
      const rawMedia = (content.media ?? null) as { kind?: unknown; dataUrl?: unknown; source?: unknown } | null;
      const kind =
        rawMedia && typeof rawMedia === "object" && TESTIMONIAL_MEDIA_KINDS.includes(rawMedia.kind as never)
          ? (rawMedia.kind as (typeof TESTIMONIAL_MEDIA_KINDS)[number])
          : "text";

      let media: TestimonialMedia;
      if (kind === "image") {
        // Same allowlist and same throw-on-invalid as the image and image_list blocks — a
        // testimonial avatar is no more trusted than a hero image, and consistency here matters
        // more than being lenient about one field.
        const dataUrl = typeof rawMedia?.dataUrl === "string" && rawMedia.dataUrl ? rawMedia.dataUrl : null;
        if (dataUrl && !isValidImageDataUrl(dataUrl)) throw new Error("invalid image data url");
        media = { kind: "image", dataUrl };
      } else if (kind === "video") {
        // Re-parsed from the display URL, never trusted as stored — identical reasoning to the
        // video block above. A forged {provider, videoId} can't reach an iframe src.
        const rs = rawMedia?.source as { provider?: unknown; videoId?: unknown; url?: unknown } | null;
        const candidate =
          rs && typeof rs === "object"
            ? sourceToDisplayUrl({
                provider: rs.provider,
                videoId: typeof rs.videoId === "string" ? rs.videoId : "",
                url: typeof rs.url === "string" ? rs.url : "",
              } as any)
            : "";
        media = { kind: "video", source: parseVideoUrl(candidate) };
      } else {
        media = { kind: "text" };
      }

      return {
        id,
        type: "testimonial",
        style,
        content: {
          quote: clampStr(content.quote, MAX_TEXT_LONG),
          name: clampStr(content.name, MAX_TEXT_SHORT),
          role: clampStr(content.role, MAX_TEXT_SHORT),
          media,
        },
      };
    }
    case "faq_item":
      return {
        id,
        type: "faq_item",
        style,
        content: { question: clampStr(content.question, MAX_TEXT_SHORT), answer: clampStr(content.answer, MAX_TEXT_MEDIUM) },
      };
    default:
      throw new Error(`unhandled element type: ${type}`);
  }
}

function validateFormInput(raw: unknown, count: { n: number }): FormInputBlock {
  if (++count.n > MAX_TOTAL_BLOCKS) throw new BlockCountLimit("too many blocks");
  const b = (raw ?? {}) as Record<string, unknown>;
  if (!isValidId(b.id)) throw new Error("invalid block id");
  if (b.type !== "form_input") throw new Error("expected form_input block");
  const content = (b.content ?? {}) as Record<string, unknown>;
  const fieldKey = typeof content.fieldKey === "string" && FIELD_KEY_RE.test(content.fieldKey) ? content.fieldKey : "";
  if (!fieldKey) throw new Error("invalid form input fieldKey");
  // Anything not in the known list falls back to a plain text input rather than being rejected —
  // a page that renders one field as text is a far better outcome than a page that won't save.
  const fieldType = (FORM_FIELD_TYPES as readonly string[]).includes(content.fieldType as string)
    ? (content.fieldType as FormFieldType)
    : "text";

  // Options are meaningless off a radio/select, so they're dropped rather than stored where
  // nothing will ever read them.
  const width = content.width === "half" ? "half" : undefined;
  const rawOptions = Array.isArray(content.options) ? content.options : [];
  const options = CHOICE_FIELD_TYPES.includes(fieldType)
    ? rawOptions
        .slice(0, MAX_FIELD_OPTIONS)
        .map((o) => clampStr(o, MAX_TEXT_SHORT))
        .filter((o) => o !== "")
    : undefined;

  return {
    id: b.id as string,
    type: "form_input",
    style: sanitizeStyle(b.style),
    content: {
      label: clampStr(content.label, MAX_TEXT_SHORT),
      fieldKey,
      fieldType,
      placeholder: clampStr(content.placeholder, MAX_TEXT_SHORT),
      required: content.required === true,
      ...(width ? { width } : {}),
      ...(options ? { options } : {}),
    },
  };
}

/**
 * Per-block responsive visibility, carried through the rebuild.
 *
 * The validator returns a freshly-built tree rather than the caller's input, so anything not
 * copied here is silently dropped on every save — the same trap `contentWidth` hit. Unknown
 * viewport names are filtered out rather than rejected: a page that won't save because of one
 * stray string in an array is worse than a block that shows everywhere.
 */
function sanitizeHidden(raw: unknown): Viewport[] {
  if (!Array.isArray(raw)) return [];
  const set = new Set<Viewport>();
  for (const v of raw) if ((VIEWPORTS as readonly string[]).includes(v as string)) set.add(v as Viewport);
  return VIEWPORTS.filter((v) => set.has(v));
}

function withHidden<T extends { type: string }>(block: T, raw: unknown): T {
  // The affiliate disclosure is mandatory on every page (content rule 3), so it is the one block
  // that must never be hideable — "hidden on mobile" would put an undisclosed affiliate page in
  // front of most of the real traffic. Enforced here, not only by leaving it out of the panel.
  if (block.type === "disclosure") return block;
  const hidden = sanitizeHidden((raw as Record<string, unknown> | null)?.hidden);
  return hidden.length ? ({ ...block, hidden } as T) : block;
}

function validateElement(raw: unknown, count: { n: number }): ElementBlock {
  return withHidden(validateElementInner(raw, count), raw);
}

function validateLockedBlock(raw: unknown, count: { n: number }): LockedBlock {
  return withHidden(validateLockedBlockInner(raw, count), raw);
}

function validateColumn(raw: unknown, count: { n: number }): ColumnBlock {
  if (++count.n > MAX_TOTAL_BLOCKS) throw new BlockCountLimit("too many blocks");
  const b = (raw ?? {}) as Record<string, unknown>;
  if (!isValidId(b.id)) throw new Error("invalid block id");
  if (b.type !== "column") throw new Error("expected column block");
  const children = Array.isArray(b.children) ? b.children : [];
  if (children.length > MAX_COLUMN_CHILDREN) throw new Error("too many elements in column");
  return withHidden({
    id: b.id as string,
    type: "column",
    style: sanitizeStyle(b.style),
    children: children.map((c) => validateElement(c, count)),
  }, b);
}

function validateRow(raw: unknown, count: { n: number }): RowBlock {
  if (++count.n > MAX_TOTAL_BLOCKS) throw new BlockCountLimit("too many blocks");
  const b = (raw ?? {}) as Record<string, unknown>;
  if (!isValidId(b.id)) throw new Error("invalid block id");
  if (b.type !== "row") throw new Error("expected row block");
  const layout = b.layout === "2col" || b.layout === "3col" ? b.layout : "1col";
  const expectedCols = layout === "3col" ? 3 : layout === "2col" ? 2 : 1;
  const columns = Array.isArray(b.columns) ? b.columns : [];
  if (columns.length !== expectedCols) throw new Error("column count doesn't match row layout");
  return withHidden({
    id: b.id as string,
    type: "row",
    layout,
    style: sanitizeStyle(b.style),
    columns: columns.map((c) => validateColumn(c, count)),
  }, b);
}

function validateSection(raw: unknown, count: { n: number }): SectionBlock {
  if (++count.n > MAX_TOTAL_BLOCKS) throw new BlockCountLimit("too many blocks");
  const b = (raw ?? {}) as Record<string, unknown>;
  if (!isValidId(b.id)) throw new Error("invalid block id");
  if (b.type !== "section") throw new Error("expected section block");
  const children = Array.isArray(b.children) ? b.children : [];
  if (children.length > MAX_SECTION_CHILDREN) throw new Error("too many blocks in section");
  return withHidden({
    id: b.id as string,
    type: "section",
    style: sanitizeStyle(b.style),
    children: children.map((c) => {
      const ct = (c as Record<string, unknown> | null)?.type;
      return ct === "row" ? validateRow(c, count) : validateElement(c, count);
    }),
  }, b);
}

function validateLockedBlockInner(raw: unknown, count: { n: number }): LockedBlock {
  if (++count.n > MAX_TOTAL_BLOCKS) throw new BlockCountLimit("too many blocks");
  const b = (raw ?? {}) as Record<string, unknown>;
  if (!isValidId(b.id)) throw new Error("invalid block id");
  const locked = b.locked;
  const style = sanitizeStyle(b.style);
  const content = (b.content ?? {}) as Record<string, unknown>;

  switch (locked) {
    case "disclosure":
      if (b.type !== "disclosure") throw new Error("locked-type mismatch");
      return { id: b.id as string, type: "disclosure", locked: "disclosure", style, content: {} };
    case "lead_capture_form": {
      if (b.type !== "lead_capture_form") throw new Error("locked-type mismatch");
      const children = Array.isArray(b.children) ? b.children : [];
      if (children.length > MAX_FORM_CHILDREN) throw new Error("too many form fields");
      const validated = children.map((c) => validateFormInput(c, count));
      const seen = new Set<string>();
      for (const f of validated) {
        if (seen.has(f.content.fieldKey)) throw new Error("duplicate form field key");
        seen.add(f.content.fieldKey);
      }
      return {
        id: b.id as string,
        type: "lead_capture_form",
        locked: "lead_capture_form",
        style,
        content: {
          ctaText: clampStr(content.ctaText, MAX_CTA) || "Get started",
          // Absent = offer, which is where the old separate primary_cta button pointed. Every
          // page saved before this shipped therefore keeps its exact destination.
          afterSubmit: validateFormSubmitAction(content.afterSubmit, { kind: "offer" }),
          successText: clampStr(content.successText, MAX_TEXT_SHORT) || "Thanks — check your inbox.",
        },
        children: validated,
      };
    }
    case "primary_cta":
      if (b.type !== "primary_cta") throw new Error("locked-type mismatch");
      return { id: b.id as string, type: "primary_cta", locked: "primary_cta", style, content: { text: clampStr(content.text, MAX_CTA) || "Continue" } };
    case "decline_link":
      if (b.type !== "decline_link") throw new Error("locked-type mismatch");
      return {
        id: b.id as string,
        type: "decline_link",
        locked: "decline_link",
        style,
        content: { text: clampStr(content.text, MAX_CTA) || "No thanks, continue" },
      };
    default:
      throw new Error(`unknown locked block kind: ${String(locked)}`);
  }
}

/**
 * A form's after-submit action. Same shape and same discipline as validateButtonAction above:
 * `url` is the only kind that yields a destination and it goes through isValidRedirectUrl, and a
 * popup target is an id, never a URL.
 *
 * Unlike a button's action this NEVER throws on a bad target — a form that refuses to save
 * because the block it pointed at was deleted would be a page you can't edit your way out of.
 * Anything unusable degrades to `message`, which the renderer treats as "show the thank-you".
 */
function validateFormSubmitAction(raw: unknown, fallback: FormSubmitAction): FormSubmitAction {
  const a = raw as { kind?: unknown; href?: unknown; formId?: unknown } | null;
  if (!a || typeof a !== "object" || typeof a.kind !== "string") return fallback;
  switch (a.kind) {
    case "offer":
      return { kind: "offer" };
    case "url": {
      const href = clampStr(a.href, 2000);
      return isValidRedirectUrl(href) ? { kind: "url", href } : { kind: "message" };
    }
    case "popup": {
      const id = clampStr(a.formId, 100);
      return ID_RE.test(id) ? { kind: "popup", formId: id } : { kind: "message" };
    }
    case "message":
      return { kind: "message" };
    default:
      return fallback;
  }
}

/**
 * On an opt-in page: exactly one of a lead form or a primary_cta, never both.
 *
 * With a form, the form's submit button decides what happens next, so a separate CTA block is the
 * duplicate button this replaced — it is dropped here so the stored tree matches what renders,
 * and the editor can't show a block the page won't emit. Without a form the CTA is the page's
 * only way out, so one is appended if it's missing rather than rejecting the save.
 *
 * Mutates in place, before the required/allowed checks read the locked kinds — deliberately the
 * one spot where the validator normalizes structure instead of only clamping content, because
 * "which of these two exists" is derived from the tree rather than chosen by the caller.
 */
function reconcileBridgeCta(blocks: (SectionBlock | LockedBlock)[], opts: ValidatePageBlockTreeOptions): void {
  if (opts.pageKind !== "bridge") return;
  // Any form, at any depth — a standalone one dropped into a section collects leads and has its
  // own after-submit action just like the locked opt-in form does.
  const hasForm = treeHasForm(blocks);

  if (hasForm) {
    let dropped = false;
    for (let i = blocks.length - 1; i >= 0; i--) {
      const b = blocks[i];
      if ("locked" in b && (b as LockedBlock).locked === "primary_cta") {
        blocks.splice(i, 1);
        dropped = true;
      }
    }
    // The dropped button was this page's route to the offer. A standalone form defaults to
    // "show a message", so removing the CTA without handing its job over would leave a page
    // taking paid traffic with no way to the offer at all — worse than the duplicate button.
    // Only promotes the default; a form already pointing somewhere specific is left alone.
    if (dropped) inheritOfferAction(blocks);
    return;
  }

  if (!blocks.some((b) => "locked" in b && (b as LockedBlock).locked === "primary_cta")) {
    blocks.push({
      id: `cta-${blocks.length}`,
      type: "primary_cta",
      locked: "primary_cta",
      style: {},
      content: { text: "Continue" },
    } as LockedBlock);
  }
}

/**
 * Point the page's LAST form at the offer, if it is still on the default "show a message".
 *
 * Last rather than first because that is the one furthest down the page — the one a reader
 * reaches after the pitch, and the one a page's own CTA sat below.
 */
function inheritOfferAction(blocks: unknown[]): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let target: any = null;
  const walk = (list: unknown[]) => {
    for (const raw of list) {
      const b = raw as any;
      if (!b || typeof b !== "object") continue;
      if (b.locked === "lead_capture_form" || b.type === "form") target = b;
      if (Array.isArray(b.children)) walk(b.children);
      if (Array.isArray(b.columns)) walk(b.columns);
    }
  };
  walk(blocks);
  if (target && target.content.afterSubmit?.kind === "message") {
    target.content.afterSubmit = { kind: "offer" };
  }
}

type LockedKind = LockedBlock["locked"];

function requiredLockedKinds(opts: ValidatePageBlockTreeOptions): Set<LockedKind> {
  // lead_capture_form is deliberately NOT required. An opt-in page without a form is a real
  // thing — a funnel that sends ad traffic straight to the offer, or a page whose form lives in a
  // later step — and forcing one meant the editor could never express it. The disclosure stays
  // mandatory (content rule 3) and so does the CTA, because a page with neither a form nor a CTA
  // has no way out at all.
  // An opt-in page's CTA is no longer a required separate block: when the page has a lead form,
  // the form's own afterSubmit action carries the destination and a primary_cta would just be a
  // second button. It is still required when there is NO form — see reconcileBridgeCta below,
  // which is where that "form or CTA, but never both" rule actually lives.
  if (opts.pageKind === "bridge") return new Set<LockedKind>(["disclosure"]);
  // Blog posts carry affiliate links, so the disclosure stays locked-and-mandatory (content rule
  // 3) — but none of the campaign-shaped blocks (lead form, CTA, decline) exist on this page kind.
  if (opts.pageKind === "blog") return new Set<LockedKind>(["disclosure"]);
  // funnel_step
  const kinds = new Set<LockedKind>(["disclosure", "primary_cta"]);
  if (opts.stepType === "upsell") kinds.add("decline_link");
  return kinds;
}

// Blog pages have no campaign to resolve hrefs/lead-endpoints against — a lead_capture_form or
// primary_cta smuggled into a blog tree would render with empty/meaningless ctx values, so they
// are rejected outright rather than rendered broken. Other page kinds allow extra locked kinds
// (e.g. a funnel step keeps its decline_link when switching step types).
function allowedLockedKinds(opts: ValidatePageBlockTreeOptions): Set<LockedKind> | null {
  if (opts.pageKind === "blog") return new Set<LockedKind>(["disclosure"]);
  return null; // no restriction beyond the required-set check
}

// Consumed by all three page-copy PATCH routes, replacing their old flat clamp/validate logic.
export function validatePageBlockTree(raw: unknown, opts: ValidatePageBlockTreeOptions): ValidationResult {
  try {
    const body = (raw ?? {}) as Record<string, unknown>;
    const blocksIn = Array.isArray(body.blocks) ? body.blocks : [];
    if (blocksIn.length === 0) return { ok: false, error: "page has no content" };
    if (blocksIn.length > MAX_ROOT_BLOCKS) return { ok: false, error: "too many top-level blocks" };

    const count = { n: 0 };
    const blocks = blocksIn.map((b) => {
      const t = (b as Record<string, unknown> | null)?.type;
      if (t === "section") return validateSection(b, count);
      if ((b as Record<string, unknown> | null)?.locked) return validateLockedBlock(b, count);
      throw new Error(`root block must be a section or a locked block, got: ${String(t)}`);
    });

    const seenIds = new Set<string>();
    for (const b of blocks) {
      if (seenIds.has(b.id)) return { ok: false, error: "duplicate block id" };
      seenIds.add(b.id);
    }

    reconcileBridgeCta(blocks, opts);

    const lockedKinds = new Set(blocks.filter((b): b is LockedBlock => "locked" in b).map((b) => b.locked));
    const required = requiredLockedKinds(opts);
    for (const kind of Array.from(required)) {
      if (!lockedKinds.has(kind)) return { ok: false, error: `missing required locked block: ${kind}` };
    }
    const allowed = allowedLockedKinds(opts);
    if (allowed) {
      for (const kind of Array.from(lockedKinds)) {
        if (!allowed.has(kind)) return { ok: false, error: `locked block not allowed on this page kind: ${kind}` };
      }
    }
    // Exactly one of each required kind (a duplicate primary_cta, say, would be ambiguous for
    // rendering and CTA-href resolution) — reject rather than silently pick one.
    for (const kind of Array.from(lockedKinds)) {
      const n = blocks.filter((b) => "locked" in b && (b as LockedBlock).locked === kind).length;
      if (n > 1) return { ok: false, error: `duplicate locked block: ${kind}` };
    }
    if (!blocks.some((b) => b.type === "section")) return { ok: false, error: "page has no sections" };

    // contentWidth rides on the tree, so it has to survive validation like anything else —
    // dropping it here would silently reset every page to the default on its next save.
    return { ok: true, tree: { version: 2, blocks, contentWidth: contentWidthOf(body), theme: sanitizeTheme(body.theme) } };
  } catch (err) {
    if (err instanceof BlockCountLimit) return { ok: false, error: err.message };
    return { ok: false, error: err instanceof Error ? err.message : "invalid page content" };
  }
}

// Reads a tree's CURRENT lead_capture_form children — used by app/api/public/leads/route.ts
// (Phase O.5) to know which extra field keys are legitimate for a submission right now. A
// fieldKey not returned here must never be trusted, even if it was valid at some point in the
// past (a field can be removed from the form after being live).
export function extractLeadFormFields(tree: PageBlockTree): { fieldKey: string; fieldType: string; required: boolean }[] {
  // Walks the WHOLE tree now, not just root: a standalone form block can sit inside a section or
  // a column, and a page can have several. Every legitimate field key on the page has to be in
  // this list or /api/public/leads silently drops it — the union is the point, and duplicates
  // across two forms are harmless because the route only checks membership.
  const out: { fieldKey: string; fieldType: string; required: boolean }[] = [];
  const take = (fields: FormInputBlock[]) => {
    for (const f of fields) {
      out.push({ fieldKey: f.content.fieldKey, fieldType: f.content.fieldType, required: f.content.required });
    }
  };
  const walk = (blocks: unknown[]) => {
    for (const raw of blocks) {
      const b = raw as Record<string, any>;
      if (!b || typeof b !== "object") continue;
      if (b.locked === "lead_capture_form" || b.type === "form") take((b.children ?? []) as FormInputBlock[]);
      if (Array.isArray(b.children)) walk(b.children);
      if (Array.isArray(b.columns)) walk(b.columns);
    }
  };
  walk(tree.blocks);
  return out;
}
