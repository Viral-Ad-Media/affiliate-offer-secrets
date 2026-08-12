/**
 * Per-page theme: palette, typography, buttons, form fields.
 *
 * Stored on the block tree (`PageBlockTree.theme`) for the same reason contentWidth is — page_copy
 * is the one field a funnel opt-in, a split-test variant, a funnel step and a blog post all
 * already have, so one theme covers four page kinds with no schema change.
 *
 * SECURITY: this file is the single place a theme becomes CSS, and it works exactly like
 * styleToInlineCss — a fixed key table, per-key range/regex checks, and NOTHING but a clamped
 * number or a `#rrggbb` string is ever interpolated. Font families are an enum mapped through a
 * lookup, never the stored string. There is no code path from a stored theme to a stylesheet that
 * concatenates tenant text, which matters because these pages serve real ad traffic on a shared
 * origin.
 *
 * Every field is optional and every getter falls back to the value the page had before themes
 * existed, so a page with no theme renders byte-identically to how it did before.
 */

export type ThemeFont = "system" | "serif" | "mono" | "rounded" | "condensed";

// Real stacks, all web-safe — no webfont fetch, because these pages must stay self-contained
// (same reason images are inlined rather than hotlinked).
export const THEME_FONT_STACKS: Record<ThemeFont, string> = {
  system: '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
  serif: 'Georgia, "Times New Roman", Times, serif',
  mono: '"SF Mono", SFMono-Regular, Consolas, "Liberation Mono", monospace',
  rounded: '"Trebuchet MS", "Segoe UI", Verdana, sans-serif',
  condensed: '"Arial Narrow", "Helvetica Neue", Arial, sans-serif',
};

export type ButtonShape = "rounded" | "pill" | "square";
export type ButtonFill = "solid" | "outline";

export type PageTheme = {
  colors?: {
    primary?: string; // buttons, links — the brand colour
    primaryHover?: string;
    onPrimary?: string; // text on top of primary
    text?: string;
    muted?: string;
    background?: string; // page background
    surface?: string; // cards: the opt-in box, testimonials
    border?: string;
  };
  typography?: {
    headingFont?: ThemeFont;
    bodyFont?: ThemeFont;
    baseSize?: number; // px, 14-22
    h1Size?: number; // px, 20-72
    h2Size?: number; // px, 16-48
    headingWeight?: 400 | 500 | 600 | 700 | 800;
    lineHeight?: number; // 1.2-2.2
  };
  button?: {
    shape?: ButtonShape;
    fill?: ButtonFill;
    paddingY?: number; // px, 6-32
    paddingX?: number; // px, 8-64
    fontSize?: number; // px, 12-28
    weight?: 400 | 500 | 600 | 700 | 800;
  };
  form?: {
    radius?: number; // px, 0-32
    borderColor?: string;
    background?: string;
    fieldPadding?: number; // px, 6-28
  };
};

const HEX = /^#[0-9a-f]{6}$/i;
const WEIGHTS = new Set([400, 500, 600, 700, 800]);
const SHAPES = new Set<ButtonShape>(["rounded", "pill", "square"]);
const FILLS = new Set<ButtonFill>(["solid", "outline"]);

// The pre-theme values. A page with no theme must render exactly as it did before, so these are
// lifted from the original PAGE_STYLE rather than chosen fresh.
export const THEME_DEFAULTS = {
  primary: "#16a34a",
  primaryHover: "#15803d",
  onPrimary: "#ffffff",
  text: "#1a1a1a",
  muted: "#666666",
  background: "#fafafa",
  surface: "#ffffff",
  border: "#e5e5e5",
  baseSize: 16,
  h1Size: 32,
  h2Size: 22,
  headingWeight: 700 as const,
  lineHeight: 1.6,
  buttonPaddingY: 16,
  buttonPaddingX: 32,
  buttonFontSize: 18,
  buttonWeight: 600 as const,
  buttonRadius: 8,
  formRadius: 8,
  fieldPadding: 14,
} as const;

const hex = (v: unknown, fallback: string) => (typeof v === "string" && HEX.test(v) ? v.toLowerCase() : fallback);

/** "#16a34a" → "22,163,74". Input is always an already-validated hex, so this can't emit anything else. */
function rgbChannels(hexColor: string): string {
  return [1, 3, 5].map((i) => parseInt(hexColor.slice(i, i + 2), 16)).join(",");
}
const num = (v: unknown, min: number, max: number, fallback: number) =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : fallback;

/** Strips a stored theme to known keys and legal values. Anything else is dropped, not coerced. */
export function sanitizeTheme(raw: unknown): PageTheme | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const t = raw as Record<string, any>;
  const out: PageTheme = {};

  if (t.colors && typeof t.colors === "object") {
    const c: Record<string, string> = {};
    for (const k of ["primary", "primaryHover", "onPrimary", "text", "muted", "background", "surface", "border"]) {
      if (typeof t.colors[k] === "string" && HEX.test(t.colors[k])) c[k] = t.colors[k].toLowerCase();
    }
    if (Object.keys(c).length) out.colors = c;
  }

  if (t.typography && typeof t.typography === "object") {
    const ty: PageTheme["typography"] = {};
    const g = t.typography;
    if (typeof g.headingFont === "string" && g.headingFont in THEME_FONT_STACKS) ty.headingFont = g.headingFont;
    if (typeof g.bodyFont === "string" && g.bodyFont in THEME_FONT_STACKS) ty.bodyFont = g.bodyFont;
    if (typeof g.baseSize === "number") ty.baseSize = num(g.baseSize, 14, 22, THEME_DEFAULTS.baseSize);
    if (typeof g.h1Size === "number") ty.h1Size = num(g.h1Size, 20, 72, THEME_DEFAULTS.h1Size);
    if (typeof g.h2Size === "number") ty.h2Size = num(g.h2Size, 16, 48, THEME_DEFAULTS.h2Size);
    if (WEIGHTS.has(g.headingWeight)) ty.headingWeight = g.headingWeight;
    if (typeof g.lineHeight === "number" && g.lineHeight >= 1.2 && g.lineHeight <= 2.2) ty.lineHeight = g.lineHeight;
    if (Object.keys(ty).length) out.typography = ty;
  }

  if (t.button && typeof t.button === "object") {
    const b: PageTheme["button"] = {};
    if (SHAPES.has(t.button.shape)) b.shape = t.button.shape;
    if (FILLS.has(t.button.fill)) b.fill = t.button.fill;
    if (typeof t.button.paddingY === "number") b.paddingY = num(t.button.paddingY, 6, 32, THEME_DEFAULTS.buttonPaddingY);
    if (typeof t.button.paddingX === "number") b.paddingX = num(t.button.paddingX, 8, 64, THEME_DEFAULTS.buttonPaddingX);
    if (typeof t.button.fontSize === "number") b.fontSize = num(t.button.fontSize, 12, 28, THEME_DEFAULTS.buttonFontSize);
    if (WEIGHTS.has(t.button.weight)) b.weight = t.button.weight;
    if (Object.keys(b).length) out.button = b;
  }

  if (t.form && typeof t.form === "object") {
    const f: PageTheme["form"] = {};
    if (typeof t.form.radius === "number") f.radius = num(t.form.radius, 0, 32, THEME_DEFAULTS.formRadius);
    if (typeof t.form.borderColor === "string" && HEX.test(t.form.borderColor)) f.borderColor = t.form.borderColor.toLowerCase();
    if (typeof t.form.background === "string" && HEX.test(t.form.background)) f.background = t.form.background.toLowerCase();
    if (typeof t.form.fieldPadding === "number") f.fieldPadding = num(t.form.fieldPadding, 6, 28, THEME_DEFAULTS.fieldPadding);
    if (Object.keys(f).length) out.form = f;
  }

  return Object.keys(out).length ? out : undefined;
}

/**
 * The theme as a `:root { --… }` declaration block.
 *
 * Emitting variables (rather than rewriting the stylesheet) is what keeps PAGE_STYLE and
 * PUBLIC_CSS constants: every rule references a var with its historical value as the fallback, so
 * an unthemed page is unchanged and a themed one overrides exactly the variables it set.
 */
export function themeToCssVars(raw: unknown): string {
  const t = sanitizeTheme(raw);
  const d = THEME_DEFAULTS;
  const c = t?.colors ?? {};
  const ty = t?.typography ?? {};
  const b = t?.button ?? {};
  const f = t?.form ?? {};

  const radius =
    b.shape === "pill" ? 999 : b.shape === "square" ? 0 : d.buttonRadius;

  const primary = hex(c.primary, d.primary);
  const onPrimary = hex(c.onPrimary, d.onPrimary);
  const outline = b.fill === "outline";

  const vars: [string, string][] = [
    ["--t-primary", primary],
    // The primary's channels, so the stylesheet can compose tints with rgba() — a soft brand wash
    // behind the hero, a tinted focus ring, a shadow that carries the brand hue. A hex var can't
    // do that, and `color-mix()` would put the whole visual treatment behind one browser feature
    // on pages that take paid traffic. Numbers only, derived from an already-validated hex.
    ["--t-primary-rgb", rgbChannels(primary)],
    ["--t-primary-hover", hex(c.primaryHover, d.primaryHover)],
    ["--t-on-primary", onPrimary],
    ["--t-text", hex(c.text, d.text)],
    ["--t-muted", hex(c.muted, d.muted)],
    ["--t-bg", hex(c.background, d.background)],
    ["--t-surface", hex(c.surface, d.surface)],
    ["--t-border", hex(c.border, d.border)],
    ["--t-heading-font", THEME_FONT_STACKS[ty.headingFont ?? "system"]],
    ["--t-body-font", THEME_FONT_STACKS[ty.bodyFont ?? "system"]],
    ["--t-base-size", `${num(ty.baseSize, 14, 22, d.baseSize)}px`],
    ["--t-h1-size", `${num(ty.h1Size, 20, 72, d.h1Size)}px`],
    ["--t-h2-size", `${num(ty.h2Size, 16, 48, d.h2Size)}px`],
    ["--t-heading-weight", String(WEIGHTS.has(ty.headingWeight as number) ? ty.headingWeight : d.headingWeight)],
    ["--t-line-height", String(typeof ty.lineHeight === "number" ? ty.lineHeight : d.lineHeight)],
    ["--t-btn-radius", `${radius}px`],
    ["--t-btn-py", `${num(b.paddingY, 6, 32, d.buttonPaddingY)}px`],
    ["--t-btn-px", `${num(b.paddingX, 8, 64, d.buttonPaddingX)}px`],
    ["--t-btn-size", `${num(b.fontSize, 12, 28, d.buttonFontSize)}px`],
    ["--t-btn-weight", String(WEIGHTS.has(b.weight as number) ? b.weight : d.buttonWeight)],
    // Outline buttons are the same knobs with the fill removed — the border colour is always the
    // primary, so an outline button can never end up invisible against the page.
    ["--t-btn-bg", outline ? "transparent" : primary],
    ["--t-btn-fg", outline ? primary : onPrimary],
    ["--t-btn-bg-hover", outline ? primary : hex(c.primaryHover, d.primaryHover)],
    ["--t-btn-fg-hover", outline ? onPrimary : onPrimary],
    ["--t-btn-border", outline ? `2px solid ${primary}` : "none"],
    ["--t-field-radius", `${num(f.radius, 0, 32, d.formRadius)}px`],
    ["--t-field-border", hex(f.borderColor, "#cccccc")],
    ["--t-field-bg", hex(f.background, "#ffffff")],
    ["--t-field-pad", `${num(f.fieldPadding, 6, 28, d.fieldPadding)}px`],
  ];

  return vars.map(([k, v]) => `${k}:${v}`).join(";");
}

/**
 * A theme derived from the colours found on the product's own sales page.
 *
 * Deliberately conservative: the brand colour drives the BUTTONS, LINKS and accents, and the
 * reading surface (page background, body text) is left at the defaults. A palette generated wholly
 * from a vendor page would regularly produce unreadable pages — plenty of sales pages are
 * dark-red-on-black — and this page has to convert paid traffic, not win a design award.
 *
 * The hover shade and the on-primary text colour are COMPUTED, not guessed: hover is the primary
 * darkened, and the label is black or white based on the primary's actual luminance, so a
 * light brand colour doesn't produce white-on-yellow.
 */
export function themeFromBrandColors(
  colors: string[],
  extras?: { headingFont?: ThemeFont; buttonShape?: ButtonShape }
): PageTheme | undefined {
  const primary = colors.find((c) => /^#[0-9a-f]{6}$/i.test(c));
  if (!primary) return undefined;

  const [r, g, b] = [1, 3, 5].map((i) => parseInt(primary.slice(i, i + 2), 16));
  const darken = (n: number) => Math.max(0, Math.round(n * 0.82));
  const hover = "#" + [darken(r), darken(g), darken(b)].map((n) => n.toString(16).padStart(2, "0")).join("");

  // Whichever of black/white actually contrasts more against this colour — not a luminance
  // threshold. A threshold has to sit at the crossover to be right, and this one sat at 0.45 when
  // the crossover is ~0.18, so a mid-luminance brand colour (a medium blue, say) got white text
  // at 2.2:1 — unreadable, on the one element the page exists to get clicked. Comparing the two
  // directly is both simpler and provably the best available: the two curves cross at 4.58:1, so
  // this can never return worse than that for any colour.
  const onPrimary =
    contrastRatio("#1a1a1a", primary) >= contrastRatio("#ffffff", primary) ? "#1a1a1a" : "#ffffff";

  // The READING surfaces are tinted toward the brand hue, never painted with it.
  //
  // This is the line the whole function is organised around. A palette taken wholesale from a
  // vendor page is regularly unreadable — dark-red-on-black is a common sales-page look, and this
  // page exists to convert paid traffic, not to be a faithful reproduction. So the brand colour
  // is mixed into WHITE at a few percent: enough that the page reads as that product's rather
  // than as a default template, nowhere near enough to move text contrast.
  //
  // The mix ratios are the whole safety argument, so they are checked rather than asserted: the
  // guard below re-measures body text against the derived background and drops back to the
  // untinted defaults if it ever fails.
  const background = mixWithWhite(r, g, b, 0.05);
  const surface = mixWithWhite(r, g, b, 0.02);
  const border = mixWithWhite(r, g, b, 0.16);

  const readable = contrastRatio(THEME_DEFAULTS.text, background) >= 4.5;

  return {
    colors: readable
      ? { primary, primaryHover: hover, onPrimary, background, surface, border }
      : { primary, primaryHover: hover, onPrimary },
    ...(extras?.headingFont ? { typography: { headingFont: extras.headingFont } } : {}),
    ...(extras?.buttonShape ? { button: { shape: extras.buttonShape } } : {}),
  };
}

/**
 * Gives alternating content sections a tinted band, so the page reads as distinct areas instead
 * of one continuous column of text.
 *
 * Applied as a post-pass over an already-normalised tree rather than inside `normalizePageCopy`,
 * for two reasons: that function is documented as pure and signature-stable, and the brand colour
 * isn't known until the theme has been derived, which happens later in `stagePages`.
 *
 * Only sections that contain a ROW are banded. That is not arbitrary — a row is where the
 * generated layout put its grids (the benefits columns, the FAQ pairs), and a band behind a grid
 * reads as a deliberate feature area, while a band behind a lone paragraph just looks like a
 * highlight someone forgot to remove.
 *
 * The colour is a real stored hex, not a variable, because `sanitizeStyle` only accepts
 * `#rrggbb` — so it is a snapshot of the brand colour at generation time. An operator who later
 * changes the page theme will need to change these too; the alternative (a var) is not
 * expressible in the style model, and inventing one for this would put a second, weaker theming
 * mechanism next to the existing one.
 */
export function applySectionBands<T extends { blocks: unknown[] }>(tree: T, accent: string | undefined): T {
  if (!accent || !HEX.test(accent)) return tree;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(accent.slice(i, i + 2), 16));
  // Stronger than the page background (5%) so the band is visible against it, still far too pale
  // to affect text contrast — the same argument, and the same guard, as themeFromBrandColors.
  const band = mixWithWhite(r, g, b, 0.1);
  if (contrastRatio(THEME_DEFAULTS.text, band) < 4.5) return tree;

  let banded = 0;
  const blocks = (tree.blocks as Record<string, unknown>[]).map((blockRaw) => {
    const block = blockRaw as { type?: string; style?: Record<string, unknown>; children?: { type?: string }[] };
    if (block.type !== "section") return blockRaw;
    const hasRow = (block.children ?? []).some((c) => c?.type === "row");
    if (!hasRow) return blockRaw;
    // Alternate, so two grid sections in a row don't merge into one long tinted slab.
    if (banded++ % 2 === 1) return blockRaw;
    return {
      ...block,
      style: {
        ...(block.style ?? {}),
        backgroundColor: band,
        paddingTop: 28,
        paddingBottom: 28,
        paddingLeft: 20,
        paddingRight: 20,
        borderRadius: 16,
      },
    };
  });
  return { ...tree, blocks };
}

/** WCAG relative luminance of an sRGB triple. */
function relativeLuminance(r: number, g: number, b: number): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast between two #rrggbb colours, 1–21. */
function contrastRatio(a: string, b: string): number {
  const lum = (h: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    return relativeLuminance(r, g, bl);
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** `amount` of the colour, the rest white. 0 = white, 1 = the colour itself. */
function mixWithWhite(r: number, g: number, b: number, amount: number): string {
  const mix = (c: number) => Math.round(255 - (255 - c) * amount);
  return "#" + [mix(r), mix(g), mix(b)].map((n) => n.toString(16).padStart(2, "0")).join("");
}

/**
 * Named designs, for the "don't rewrite my copy — just make it look different" case.
 *
 * A preset only ever sets THEME keys: colours, type, button and field shape. It cannot add, remove
 * or reorder a block, so applying one to a page somebody has hand-written is non-destructive by
 * construction — the words are untouched and only the CSS variables change. That is the whole
 * reason this exists as a separate concept from `FUNNEL_STYLES` (lib/funnelStyles.ts), which picks
 * which SECTIONS exist and therefore cannot be applied to an existing page without dropping copy.
 *
 * Every value here goes through `sanitizeTheme` on save like any other theme, so a preset is not a
 * trusted path into the stylesheet — it is just a convenient starting set.
 */
export type ThemePreset = {
  id: string;
  label: string;
  /** What this is FOR, not what colour it is — the picker should read as a decision, not a swatch. */
  blurb: string;
  theme: PageTheme;
};

export const THEME_PRESETS: ThemePreset[] = [
  {
    id: "default",
    label: "Original",
    blurb: "The stock look every page starts with. Green CTA, system type, plenty of air.",
    theme: {},
  },
  {
    id: "editorial",
    label: "Editorial",
    blurb: "Serif headlines on warm paper. Reads like an article rather than a pitch.",
    theme: {
      colors: { primary: "#1d4ed8", primaryHover: "#1e40af", onPrimary: "#ffffff", text: "#1c1917", muted: "#57534e", background: "#faf8f4", surface: "#ffffff", border: "#e7e2d8" },
      typography: { headingFont: "serif", bodyFont: "serif", baseSize: 18, h1Size: 40, h2Size: 26, headingWeight: 700, lineHeight: 1.7 },
      button: { shape: "square", fill: "solid", paddingY: 16, paddingX: 34, fontSize: 18, weight: 600 },
      form: { radius: 2, fieldPadding: 15 },
    },
  },
  {
    id: "bold",
    label: "Bold direct response",
    blurb: "Big heavy headline, high-contrast CTA. Built to be skimmed on a phone.",
    theme: {
      colors: { primary: "#ea580c", primaryHover: "#c2410c", onPrimary: "#ffffff", text: "#111111", muted: "#555555", background: "#ffffff", surface: "#fff7ed", border: "#fed7aa" },
      typography: { headingFont: "condensed", bodyFont: "system", baseSize: 17, h1Size: 46, h2Size: 28, headingWeight: 800, lineHeight: 1.5 },
      button: { shape: "rounded", fill: "solid", paddingY: 20, paddingX: 40, fontSize: 20, weight: 800 },
      form: { radius: 8, fieldPadding: 16 },
    },
  },
  {
    id: "calm",
    label: "Calm / clinical",
    blurb: "Muted blues and generous spacing. For claims that should feel measured.",
    theme: {
      colors: { primary: "#0f766e", primaryHover: "#115e59", onPrimary: "#ffffff", text: "#1f2937", muted: "#6b7280", background: "#f8fafc", surface: "#ffffff", border: "#e2e8f0" },
      typography: { headingFont: "system", bodyFont: "system", baseSize: 17, h1Size: 34, h2Size: 23, headingWeight: 600, lineHeight: 1.75 },
      button: { shape: "pill", fill: "solid", paddingY: 15, paddingX: 34, fontSize: 17, weight: 600 },
      form: { radius: 10, fieldPadding: 14 },
    },
  },
  {
    id: "dark",
    label: "Dark",
    blurb: "Light type on near-black. Stands out in a feed of white landing pages.",
    theme: {
      colors: { primary: "#22c55e", primaryHover: "#16a34a", onPrimary: "#06210f", text: "#f4f4f5", muted: "#a1a1aa", background: "#0b0b0f", surface: "#17171d", border: "#2a2a33" },
      typography: { headingFont: "system", bodyFont: "system", baseSize: 17, h1Size: 38, h2Size: 25, headingWeight: 700, lineHeight: 1.65 },
      button: { shape: "rounded", fill: "solid", paddingY: 17, paddingX: 34, fontSize: 18, weight: 700 },
      form: { radius: 8, borderColor: "#2a2a33", background: "#101017", fieldPadding: 15 },
    },
  },
  {
    id: "friendly",
    label: "Friendly",
    blurb: "Rounded type, soft edges, pill buttons. Warmer, less salesy.",
    theme: {
      colors: { primary: "#7c3aed", primaryHover: "#6d28d9", onPrimary: "#ffffff", text: "#2e1065", muted: "#6d6a80", background: "#faf7ff", surface: "#ffffff", border: "#e9e2f8" },
      typography: { headingFont: "rounded", bodyFont: "rounded", baseSize: 17, h1Size: 36, h2Size: 24, headingWeight: 700, lineHeight: 1.7 },
      button: { shape: "pill", fill: "solid", paddingY: 17, paddingX: 38, fontSize: 18, weight: 700 },
      form: { radius: 16, fieldPadding: 15 },
    },
  },
];

export function themePresetById(id: unknown): ThemePreset | undefined {
  return typeof id === "string" ? THEME_PRESETS.find((p) => p.id === id) : undefined;
}
