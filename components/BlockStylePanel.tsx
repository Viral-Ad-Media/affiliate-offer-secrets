"use client";

import { X } from "lucide-react";
import { STYLE_KEYS_BY_TYPE, type Block, type BlockStyle, type FontFamily } from "@/lib/engine/renderPages";

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
  onClose: () => void;
};

// Selected via WysiwygCanvas.tsx (Phase O.4) — clicking any Section/Row/Element/locked block
// selects it here (columns are not independently selectable in this pass, a deliberate v1 scope
// cut; a column's own Row already covers the common "give this area a background" need).
export default function BlockStylePanel({ block, onChange, onClose }: BlockStylePanelProps) {
  if (!block) return null;

  const allowedKeys = (STYLE_KEYS_BY_TYPE as Record<string, readonly (keyof BlockStyle)[]>)[block.type] ?? [];
  const allowed = new Set(allowedKeys);
  const has = (k: keyof BlockStyle) => allowed.has(k);
  const style = block.style ?? {};

  function set(patch: BlockStyle) {
    onChange(block!.id, patch);
  }

  const showTypography = has("fontFamily") || has("fontSize") || has("fontWeight") || has("textAlign") || has("color") || has("lineHeight");
  const showBackground = has("backgroundColor");
  const showSpacing =
    has("paddingTop") || has("paddingRight") || has("paddingBottom") || has("paddingLeft") || has("marginTop") || has("marginBottom");
  const showBorder = has("borderWidth") || has("borderColor") || has("borderRadius");
  const showLayout = has("maxWidth");

  if (!showTypography && !showBackground && !showSpacing && !showBorder && !showLayout) return null;

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
            <ColorField label="Background color" value={style.backgroundColor} onChange={(v) => set({ backgroundColor: v })} />
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
            <NumberField label="Max width (px)" value={style.maxWidth} min={100} max={1200} onChange={(v) => set({ maxWidth: v })} />
          </div>
        )}
      </div>
    </div>
  );
}
