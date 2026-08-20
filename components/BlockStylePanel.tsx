"use client";

import { X, Monitor, Tablet, Smartphone, EyeOff } from "lucide-react";
import {
  STYLE_KEYS_BY_TYPE,
  VIEWPORTS,
  ASPECT_RATIO_NAMES,
  type AspectRatio,
  type Viewport,
  type Block,
  type BlockStyle,
  type FontFamily,
} from "@/lib/engine/renderPages";

/** Plain-language names for the crop frames — "4:5" means nothing to most people on its own. */
const ASPECT_RATIO_LABELS: Record<AspectRatio, string> = {
  original: "Original (no crop)",
  "1:1": "Square — 1:1",
  "4:3": "Landscape — 4:3",
  "3:2": "Landscape — 3:2",
  "16:9": "Wide — 16:9",
  "4:5": "Portrait — 4:5",
  "9:16": "Tall — 9:16",
};

/** The nine focal presets, in reading order so the grid maps 1:1 onto the buttons. */
const FOCAL_POINTS: { x: number; y: number; title: string }[] = [
  { x: 0, y: 0, title: "Top left" },
  { x: 50, y: 0, title: "Top" },
  { x: 100, y: 0, title: "Top right" },
  { x: 0, y: 50, title: "Left" },
  { x: 50, y: 50, title: "Centre" },
  { x: 100, y: 50, title: "Right" },
  { x: 0, y: 100, title: "Bottom left" },
  { x: 50, y: 100, title: "Bottom" },
  { x: 100, y: 100, title: "Bottom right" },
];

/** Same three widths as the canvas's own device toggle, so the control matches the preview. */
const VIEWPORT_ICONS: Record<Viewport, typeof Monitor> = {
  desktop: Monitor,
  tablet: Tablet,
  mobile: Smartphone,
};

// The panel only ever renders controls for keys present in STYLE_KEYS_BY_TYPE[block.type]
// (lib/engine/blockTree.ts) — the same table the renderer itself consults via styleToInlineCss's
// `allowed` param, so a control never appears here unless editing it would actually change the
// published page. Client-side clamping below is a UX nicety, never the boundary — saving always
// re-validates through validatePageBlockTree.ts.

const BLOCK_TYPE_LABELS: Record<string, string> = {
  heading: "Heading",
  subheading: "Subheading",
  paragraph: "Paragraph",
  image: "Image",
  bullet_list: "Bullet list",
  icon_list: "Icon list",
  divider: "Divider",
  image_list: "Image list",
  button: "Button",
  video: "Video",
  faq_item: "FAQ item",
  column: "Column",
  row: "Row",
  section: "Section",
  disclosure: "Disclosure",
  lead_capture_form: "Lead capture form",
  primary_cta: "Primary button",
  decline_link: "Decline link",
};

const FONT_FAMILY_OPTIONS: { value: FontFamily; label: string }[] = [
  { value: "system", label: "System (sans-serif)" },
  { value: "serif", label: "Serif" },
  { value: "mono", label: "Monospace" },
];
const FONT_WEIGHT_OPTIONS = [400, 500, 600, 700, 800] as const;
const TEXT_ALIGN_OPTIONS: { value: NonNullable<BlockStyle["textAlign"]>; label: string }[] = [
  { value: "left", label: "Left" },
  { value: "center", label: "Center" },
  { value: "right", label: "Right" },
];

function fieldLabelClass() {
  return "mb-1 block text-[12px] font-medium text-zinc-400";
}
function fieldInputClass() {
  return "w-full rounded border border-ink-600 bg-ink-800 px-2 py-1 text-xs text-zinc-100";
}

function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
}: {
  label: string;
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  min: number;
  max: number;
  step?: number;
}) {
  return (
    <label className="block">
      <span className={fieldLabelClass()}>{label}</span>
      <input
        type="number"
        value={value ?? ""}
        min={min}
        max={max}
        step={step}
        placeholder="—"
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === "") {
            onChange(undefined);
            return;
          }
          const n = Number(raw);
          if (!Number.isFinite(n)) return;
          onChange(Math.min(max, Math.max(min, n)));
        }}
        className={fieldInputClass()}
      />
    </label>
  );
}

function BackgroundImageField({
  value,
  resizeImageFile,
  onChange,
}: {
  value: string | undefined;
  resizeImageFile: (file: File) => Promise<string>;
  onChange: (v: string | undefined) => void;
}) {
  // Same client-side downscale + data-URI flow the image block uses; the value is validated as an
  // image ref both on save (sanitizeStyle) and at render (styleToInlineCss). A quote can't appear
  // in a resized data URI, but the preview strips one defensively before it reaches an inline style.
  const pick = async (file: File | undefined) => {
    if (!file) return;
    onChange(await resizeImageFile(file));
  };
  const accept = "image/png,image/jpeg,image/webp,image/gif";
  return (
    <div>
      <span className={fieldLabelClass()}>Background image</span>
      {value ? (
        <div className="space-y-1.5">
          <div
            className="h-16 w-full rounded border border-ink-600 bg-cover bg-center"
            style={{ backgroundImage: `url('${value.replace(/'/g, "")}')` }}
          />
          <div className="flex items-center gap-2">
            <label className="cursor-pointer rounded border border-ink-600 px-2 py-1 text-[12px] text-zinc-300 hover:border-ink-500">
              Replace
              <input
                type="file"
                accept={accept}
                className="hidden"
                onChange={(e) => {
                  void pick(e.target.files?.[0]);
                  e.currentTarget.value = "";
                }}
              />
            </label>
            <button type="button" onClick={() => onChange(undefined)} className="text-[12px] text-zinc-500 hover:text-red-300">
              Remove
            </button>
          </div>
        </div>
      ) : (
        <label className="flex cursor-pointer items-center justify-center rounded border border-dashed border-ink-600 px-2 py-3 text-[12px] text-zinc-500 hover:border-ink-500">
          Upload image
          <input
            type="file"
            accept={accept}
            className="hidden"
            onChange={(e) => {
              void pick(e.target.files?.[0]);
              e.currentTarget.value = "";
            }}
          />
        </label>
      )}
      <p className="mt-1 text-[11px] leading-snug text-zinc-600">
        Sits behind this section. Give it padding and a text colour so the copy stays readable.
      </p>
    </div>
  );
}

function ColorField({ label, value, onChange }: { label: string; value: string | undefined; onChange: (v: string | undefined) => void }) {
  return (
    <label className="block">
      <span className={fieldLabelClass()}>{label}</span>
      <div className="flex items-center gap-1.5">
        <input
          type="color"
          value={value ?? "#000000"}
          onChange={(e) => onChange(e.target.value)}
          className="h-7 w-9 cursor-pointer rounded border border-ink-600 bg-ink-800 p-0.5"
        />
        {value ? (
          <button type="button" onClick={() => onChange(undefined)} className="text-[12px] text-zinc-500 hover:text-zinc-300">
            Clear
          </button>
        ) : (
          <span className="text-[12px] text-zinc-600">Default</span>
        )}
      </div>
    </label>
  );
}

export type BlockStylePanelProps = {
  block: Block | null;
  onChange: (blockId: string, patch: BlockStyle) => void;
  /** Responsive visibility is not a style key — it becomes a CLASS, so it has its own setter. */
  onVisibilityChange: (blockId: string, hidden: Viewport[]) => void;
  /** Client-side downscale for the section background-image upload — the canvas's own helper. */
  resizeImageFile: (file: File) => Promise<string>;
  onClose: () => void;
};

// Selected via WysiwygCanvas.tsx (Phase O.4) — clicking any Section/Row/Element/locked block
// selects it here (columns are not independently selectable in this pass, a deliberate v1 scope
// cut; a column's own Row already covers the common "give this area a background" need).
export default function BlockStylePanel({ block, onChange, onVisibilityChange, resizeImageFile, onClose }: BlockStylePanelProps) {
  if (!block) return null;

  const allowedKeys = (STYLE_KEYS_BY_TYPE as Record<string, readonly (keyof BlockStyle)[]>)[block.type] ?? [];
  const allowed = new Set(allowedKeys);
  const has = (k: keyof BlockStyle) => allowed.has(k);
  const style = block.style ?? {};

  function set(patch: BlockStyle) {
    onChange(block!.id, patch);
  }

  const showTypography = has("fontFamily") || has("fontSize") || has("fontWeight") || has("textAlign") || has("color") || has("lineHeight");
  const showBackground = has("backgroundColor") || has("backgroundImage");
  const showSpacing =
    has("paddingTop") || has("paddingRight") || has("paddingBottom") || has("paddingLeft") || has("marginTop") || has("marginBottom");
  const showBorder = has("borderWidth") || has("borderColor") || has("borderRadius");
  const showLayout = has("maxWidth") || has("width") || has("align");
  const showFields =
    has("fieldBackgroundColor") || has("fieldTextColor") || has("fieldBorderColor") ||
    has("fieldBorderWidth") || has("fieldBorderRadius") || has("fieldGap");
  const showImage = has("imageWidth") || has("aspectRatio");
  const showLinks = has("linkColor") || has("linkActiveColor");

  // The disclosure is the one block that can't be hidden — content rule 3 makes it mandatory on
  // every page, and "hidden on mobile" would put an undisclosed affiliate page in front of most of
  // the real traffic. The validator drops `hidden` on it independently; this just doesn't offer it.
  const showVisibility = block.type !== "disclosure";
  const hidden = ((block as { hidden?: Viewport[] }).hidden ?? []) as Viewport[];
  function toggleViewport(v: Viewport) {
    const next = hidden.includes(v) ? hidden.filter((x) => x !== v) : [...hidden, v];
    onVisibilityChange(block!.id, VIEWPORTS.filter((x) => next.includes(x)));
  }

  if (
    !showTypography && !showBackground && !showSpacing && !showBorder && !showLayout && !showFields &&
    !showImage && !showLinks && !showVisibility
  )
    return null;

  return (
    <div className="mt-4 rounded-lg border border-ink-700 bg-ink-900 p-4 lg:mt-0">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
          Style — {BLOCK_TYPE_LABELS[block.type] ?? block.type}
        </h3>
        <button type="button" onClick={onClose} title="Deselect" className="text-zinc-500 hover:text-zinc-300">
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Single-column stack: this panel docks in a ~320px side rail on lg+ (WysiwygCanvas's
          three-zone layout); each group's own internal 2-col grid fits that width. Below lg it
          renders under the canvas where a single column also reads fine. */}
      <div className="grid gap-4">
        {showVisibility && (
          <div className="space-y-2 sm:col-span-2">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Visibility</div>
            <div className="flex gap-1.5">
              {VIEWPORTS.map((v) => {
                const Icon = VIEWPORT_ICONS[v];
                const isHidden = hidden.includes(v);
                return (
                  <button
                    key={v}
                    type="button"
                    onClick={() => toggleViewport(v)}
                    aria-pressed={!isHidden}
                    title={isHidden ? `Hidden on ${v} — click to show` : `Shown on ${v} — click to hide`}
                    className={`flex flex-1 flex-col items-center gap-1 rounded-lg border px-2 py-2 text-[11px] capitalize transition-colors ${
                      isHidden
                        ? "border-ink-700 bg-ink-800 text-zinc-600"
                        : "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                    }`}
                  >
                    <span className="relative">
                      <Icon className="h-4 w-4" />
                      {isHidden && <EyeOff className="absolute -right-2 -top-1.5 h-3 w-3" />}
                    </span>
                    {v}
                  </button>
                );
              })}
            </div>
            <p className="text-[11px] text-zinc-500">
              Click a width to hide this block there. It still shows in the editor, marked, so you can
              bring it back.
            </p>
          </div>
        )}

        {showTypography && (
          <div className="space-y-2 sm:col-span-2">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Typography</div>
            <div className="grid grid-cols-2 gap-2">
              {has("fontFamily") && (
                <label className="col-span-2 block">
                  <span className={fieldLabelClass()}>Font</span>
                  <select
                    value={style.fontFamily ?? "system"}
                    onChange={(e) => set({ fontFamily: e.target.value as FontFamily })}
                    className={fieldInputClass()}
                  >
                    {FONT_FAMILY_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {has("fontSize") && <NumberField label="Size (px)" value={style.fontSize} min={8} max={96} onChange={(v) => set({ fontSize: v })} />}
              {has("fontWeight") && (
                <label className="block">
                  <span className={fieldLabelClass()}>Weight</span>
                  <select
                    value={style.fontWeight ?? 400}
                    onChange={(e) => set({ fontWeight: Number(e.target.value) as BlockStyle["fontWeight"] })}
                    className={fieldInputClass()}
                  >
                    {FONT_WEIGHT_OPTIONS.map((w) => (
                      <option key={w} value={w}>
                        {w}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {has("lineHeight") && (
                <NumberField label="Line height" value={style.lineHeight} min={1} max={2.5} step={0.1} onChange={(v) => set({ lineHeight: v })} />
              )}
              {has("textAlign") && (
                <label className="col-span-2 block">
                  <span className={fieldLabelClass()}>Align</span>
                  <div className="flex gap-1">
                    {TEXT_ALIGN_OPTIONS.map((o) => (
                      <button
                        key={o.value}
                        type="button"
                        onClick={() => set({ textAlign: o.value })}
                        className={`flex-1 rounded border px-2 py-1 text-xs ${
                          style.textAlign === o.value
                            ? "border-emerald-500 bg-emerald-500/15 text-emerald-300"
                            : "border-ink-600 text-zinc-400 hover:border-ink-500"
                        }`}
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                </label>
              )}
              {has("color") && (
                <div className="col-span-2">
                  <ColorField label="Text color" value={style.color} onChange={(v) => set({ color: v })} />
                </div>
              )}
            </div>
          </div>
        )}

        {showBackground && (
          <div className="space-y-2">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Background</div>
            {has("backgroundColor") && (
              <ColorField label="Background color" value={style.backgroundColor} onChange={(v) => set({ backgroundColor: v })} />
            )}
            {has("backgroundImage") && (
              <BackgroundImageField
                value={style.backgroundImage}
                resizeImageFile={resizeImageFile}
                onChange={(v) => set({ backgroundImage: v })}
              />
            )}
          </div>
        )}

        {showSpacing && (
          <div className="space-y-2">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Spacing (px)</div>
            <div className="grid grid-cols-2 gap-2">
              {has("paddingTop") && <NumberField label="Padding top" value={style.paddingTop} min={0} max={200} onChange={(v) => set({ paddingTop: v })} />}
              {has("paddingRight") && (
                <NumberField label="Padding right" value={style.paddingRight} min={0} max={200} onChange={(v) => set({ paddingRight: v })} />
              )}
              {has("paddingBottom") && (
                <NumberField label="Padding bottom" value={style.paddingBottom} min={0} max={200} onChange={(v) => set({ paddingBottom: v })} />
              )}
              {has("paddingLeft") && (
                <NumberField label="Padding left" value={style.paddingLeft} min={0} max={200} onChange={(v) => set({ paddingLeft: v })} />
              )}
              {has("marginTop") && <NumberField label="Margin top" value={style.marginTop} min={0} max={200} onChange={(v) => set({ marginTop: v })} />}
              {has("marginBottom") && (
                <NumberField label="Margin bottom" value={style.marginBottom} min={0} max={200} onChange={(v) => set({ marginBottom: v })} />
              )}
            </div>
          </div>
        )}

        {showBorder && (
          <div className="space-y-2">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Border</div>
            <div className="grid grid-cols-2 gap-2">
              {has("borderWidth") && <NumberField label="Width (px)" value={style.borderWidth} min={0} max={16} onChange={(v) => set({ borderWidth: v })} />}
              {has("borderRadius") && (
                <NumberField label="Radius (px)" value={style.borderRadius} min={0} max={64} onChange={(v) => set({ borderRadius: v })} />
              )}
              {has("borderColor") && (
                <div className="col-span-2">
                  <ColorField label="Border color" value={style.borderColor} onChange={(v) => set({ borderColor: v })} />
                </div>
              )}
            </div>
          </div>
        )}

        {showLayout && (
          <div className="space-y-2">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Layout</div>
            {has("maxWidth") && (
              <NumberField label="Max width (px)" value={style.maxWidth} min={100} max={1200} onChange={(v) => set({ maxWidth: v })} />
            )}
            {has("width") && (
              <label className="col-span-2 block">
                <span className={fieldLabelClass()}>Width</span>
                <select
                  value={style.width ?? "auto"}
                  onChange={(e) => set({ width: e.target.value as "auto" | "full" })}
                  className={fieldInputClass()}
                >
                  <option value="auto">Fit to text</option>
                  <option value="full">Full width</option>
                </select>
              </label>
            )}
            {has("align") && (
              <label className="col-span-2 block">
                {/* Places the BOX. Text alignment inside it is the Typography group's job — they
                    look alike and do different things, so both are labelled for what they move. */}
                <span className={fieldLabelClass()}>Position on the page</span>
                <select
                  value={style.align ?? "left"}
                  onChange={(e) => set({ align: e.target.value as "left" | "center" | "right" })}
                  className={fieldInputClass()}
                >
                  <option value="left">Left</option>
                  <option value="center">Centre</option>
                  <option value="right">Right</option>
                </select>
              </label>
            )}
          </div>
        )}

        {showImage && (
          <div className="space-y-2 sm:col-span-2">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Size &amp; crop</div>

            <label className="block">
              <span className={fieldLabelClass()}>Width</span>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={10}
                  max={100}
                  step={5}
                  value={style.imageWidth ?? 100}
                  onChange={(e) => set({ imageWidth: Number(e.target.value) })}
                  className="h-1 flex-1 cursor-pointer appearance-none rounded bg-ink-700 accent-emerald-500"
                />
                <span className="w-10 text-right text-[12px] tabular-nums text-zinc-400">
                  {style.imageWidth ?? 100}%
                </span>
              </div>
            </label>

            <label className="block">
              <span className={fieldLabelClass()}>Crop to shape</span>
              <select
                value={style.aspectRatio ?? "original"}
                onChange={(e) => set({ aspectRatio: e.target.value as AspectRatio })}
                className={fieldInputClass()}
              >
                {ASPECT_RATIO_NAMES.map((r) => (
                  <option key={r} value={r}>
                    {r === "original" ? "Original (no crop)" : ASPECT_RATIO_LABELS[r]}
                  </option>
                ))}
              </select>
            </label>

            {/* Everything below only does something under a crop — a fit mode and a focal point
                have nothing to act on while the image is at its own shape. Hidden rather than
                disabled: a control that can't do anything yet is noise in a 320px rail. */}
            {(style.aspectRatio ?? "original") !== "original" && (
              <>
                <label className="block">
                  <span className={fieldLabelClass()}>How it fills the shape</span>
                  <select
                    value={style.objectFit ?? "cover"}
                    onChange={(e) => set({ objectFit: e.target.value as "cover" | "contain" })}
                    className={fieldInputClass()}
                  >
                    <option value="cover">Fill the frame (crops the edges)</option>
                    <option value="contain">Fit inside (shows all of it)</option>
                  </select>
                </label>

                {(style.objectFit ?? "cover") === "cover" && (
                  <div>
                    <span className={fieldLabelClass()}>Keep this part in frame</span>
                    {/* Nine presets rather than two sliders: cropping is a "keep the face, lose the
                        floor" decision, and a grid says that at a glance in a narrow rail. The
                        stored value is a plain percentage, so a finer one set elsewhere survives. */}
                    <div className="grid w-[84px] grid-cols-3 gap-0.5">
                      {FOCAL_POINTS.map(({ x, y, title }) => {
                        const active = (style.focalX ?? 50) === x && (style.focalY ?? 50) === y;
                        return (
                          <button
                            key={`${x}-${y}`}
                            type="button"
                            title={title}
                            aria-label={title}
                            aria-pressed={active}
                            onClick={() => set({ focalX: x, focalY: y })}
                            className={`h-6 w-6 rounded border ${
                              active
                                ? "border-emerald-500 bg-emerald-500/30"
                                : "border-ink-600 bg-ink-800 hover:border-ink-500"
                            }`}
                          />
                        );
                      })}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {showLinks && (
          <div className="space-y-2 sm:col-span-2">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Links</div>
            <div className="grid gap-3 sm:grid-cols-2">
              <ColorField label="Link color" value={style.linkColor} onChange={(v) => set({ linkColor: v })} />
              <ColorField
                label="Hover / focus color"
                value={style.linkActiveColor}
                onChange={(v) => set({ linkActiveColor: v })}
              />
            </div>
            {/* Named for what it does. A "current section" highlight would need a scroll listener,
                and buying it would cost blog posts their zero-JS property — so it is not offered
                rather than offered and quietly not working. */}
            <p className="text-[11px] leading-snug text-zinc-500">
              The second colour applies while a link is hovered or keyboard-focused.
            </p>
          </div>
        )}

        {showFields && (
          <div className="space-y-2 sm:col-span-2">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Form fields</div>
            <div className="grid gap-3 sm:grid-cols-2">
              <ColorField label="Field background" value={style.fieldBackgroundColor} onChange={(v) => set({ fieldBackgroundColor: v })} />
              <ColorField label="Field text" value={style.fieldTextColor} onChange={(v) => set({ fieldTextColor: v })} />
              <ColorField label="Field border" value={style.fieldBorderColor} onChange={(v) => set({ fieldBorderColor: v })} />
              <NumberField label="Border width (px)" value={style.fieldBorderWidth} min={0} max={8} onChange={(v) => set({ fieldBorderWidth: v })} />
              <NumberField label="Corner radius (px)" value={style.fieldBorderRadius} min={0} max={40} onChange={(v) => set({ fieldBorderRadius: v })} />
              <NumberField label="Space between (px)" value={style.fieldGap} min={0} max={40} onChange={(v) => set({ fieldGap: v })} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
