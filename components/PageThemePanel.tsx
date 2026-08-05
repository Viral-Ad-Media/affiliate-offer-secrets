"use client";

import { useState } from "react";
import { Palette, Type, MousePointerClick, TextCursorInput } from "lucide-react";
import {
  THEME_DEFAULTS,
  THEME_FONT_STACKS,
  type PageTheme,
  type ThemeFont,
} from "@/lib/engine/pageTheme";
import type { PageBlockTree } from "@/lib/engine/renderPages";

/**
 * Per-page theme editor: palette, typography, buttons, form fields.
 *
 * Every control writes into `tree.theme`, which the server sanitizes again on save
 * (lib/engine/pageTheme.ts). This is UX-side clamping only — same split as BlockStylePanel.
 *
 * Unset means "the value the page had before themes existed", so the inputs show the defaults
 * rather than empty boxes: a colour picker with no value is a worse lie than one showing the
 * colour actually being used.
 */
export default function PageThemePanel({
  tree,
  onChange,
}: {
  tree: PageBlockTree;
  onChange: (tree: PageBlockTree) => void;
}) {
  const theme: PageTheme = tree.theme ?? {};
  const [tab, setTab] = useState<"colors" | "type" | "button" | "form">("colors");

  const patch = (part: Partial<PageTheme>) =>
    onChange({
      ...tree,
      theme: {
        ...theme,
        ...part,
        colors: { ...theme.colors, ...(part.colors ?? {}) },
        typography: { ...theme.typography, ...(part.typography ?? {}) },
        button: { ...theme.button, ...(part.button ?? {}) },
        form: { ...theme.form, ...(part.form ?? {}) },
      },
    });

  const d = THEME_DEFAULTS;
  const c = theme.colors ?? {};
  const ty = theme.typography ?? {};
  const b = theme.button ?? {};
  const f = theme.form ?? {};

  const TABS = [
    { key: "colors" as const, label: "Colors", icon: Palette },
    { key: "type" as const, label: "Type", icon: Type },
    { key: "button" as const, label: "Buttons", icon: MousePointerClick },
    { key: "form" as const, label: "Form", icon: TextCursorInput },
  ];

  return (
    <section className="card space-y-3 p-4">
      <div>
        <h2 className="text-sm font-semibold text-zinc-100">Theme</h2>
        <p className="mt-0.5 text-[11px] leading-snug text-zinc-500">
          Applies to this page only. A kit built from a product starts from that product&apos;s own
          brand colours.
        </p>
      </div>

      <div className="flex gap-1">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`flex flex-1 items-center justify-center gap-1 rounded px-2 py-1 text-[11px] ${
              tab === key ? "bg-emerald-500/15 text-emerald-300" : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            <Icon className="h-3 w-3" /> {label}
          </button>
        ))}
      </div>

      {tab === "colors" && (
        <div className="space-y-2">
          <Color label="Primary" value={c.primary ?? d.primary} onChange={(v) => patch({ colors: { primary: v } })} />
          <Color label="Primary (hover)" value={c.primaryHover ?? d.primaryHover} onChange={(v) => patch({ colors: { primaryHover: v } })} />
          <Color label="Text on primary" value={c.onPrimary ?? d.onPrimary} onChange={(v) => patch({ colors: { onPrimary: v } })} />
          <Color label="Body text" value={c.text ?? d.text} onChange={(v) => patch({ colors: { text: v } })} />
          <Color label="Muted text" value={c.muted ?? d.muted} onChange={(v) => patch({ colors: { muted: v } })} />
          <Color label="Page background" value={c.background ?? d.background} onChange={(v) => patch({ colors: { background: v } })} />
          <Color label="Card background" value={c.surface ?? d.surface} onChange={(v) => patch({ colors: { surface: v } })} />
          <Color label="Borders" value={c.border ?? d.border} onChange={(v) => patch({ colors: { border: v } })} />
        </div>
      )}

      {tab === "type" && (
        <div className="space-y-2">
          <Font label="Headings" value={ty.headingFont ?? "system"} onChange={(v) => patch({ typography: { headingFont: v } })} />
          <Font label="Body" value={ty.bodyFont ?? "system"} onChange={(v) => patch({ typography: { bodyFont: v } })} />
          <Num label="Body size" value={ty.baseSize ?? d.baseSize} min={14} max={22} onChange={(v) => patch({ typography: { baseSize: v } })} />
          <Num label="H1 size" value={ty.h1Size ?? d.h1Size} min={20} max={72} onChange={(v) => patch({ typography: { h1Size: v } })} />
          <Num label="H2 size" value={ty.h2Size ?? d.h2Size} min={16} max={48} onChange={(v) => patch({ typography: { h2Size: v } })} />
          <Select
            label="Heading weight"
            value={String(ty.headingWeight ?? d.headingWeight)}
            options={[400, 500, 600, 700, 800].map((w) => ({ value: String(w), label: String(w) }))}
            onChange={(v) => patch({ typography: { headingWeight: Number(v) as 400 } })}
          />
          <Num label="Line height" value={ty.lineHeight ?? d.lineHeight} min={1.2} max={2.2} step={0.05} onChange={(v) => patch({ typography: { lineHeight: v } })} />
        </div>
      )}

      {tab === "button" && (
        <div className="space-y-2">
          <Select
            label="Shape"
            value={b.shape ?? "rounded"}
            options={[
              { value: "rounded", label: "Rounded" },
              { value: "pill", label: "Pill" },
              { value: "square", label: "Square" },
            ]}
            onChange={(v) => patch({ button: { shape: v as "pill" } })}
          />
          <Select
            label="Fill"
            value={b.fill ?? "solid"}
            options={[
              { value: "solid", label: "Solid" },
              { value: "outline", label: "Outline" },
            ]}
            onChange={(v) => patch({ button: { fill: v as "solid" } })}
          />
          <Num label="Height (padding)" value={b.paddingY ?? d.buttonPaddingY} min={6} max={32} onChange={(v) => patch({ button: { paddingY: v } })} />
          <Num label="Width (padding)" value={b.paddingX ?? d.buttonPaddingX} min={8} max={64} onChange={(v) => patch({ button: { paddingX: v } })} />
          <Num label="Text size" value={b.fontSize ?? d.buttonFontSize} min={12} max={28} onChange={(v) => patch({ button: { fontSize: v } })} />
          <Select
            label="Text weight"
            value={String(b.weight ?? d.buttonWeight)}
            options={[400, 500, 600, 700, 800].map((w) => ({ value: String(w), label: String(w) }))}
            onChange={(v) => patch({ button: { weight: Number(v) as 600 } })}
          />
        </div>
      )}

      {tab === "form" && (
        <div className="space-y-2">
          <Num label="Field corners" value={f.radius ?? d.formRadius} min={0} max={32} onChange={(v) => patch({ form: { radius: v } })} />
          <Num label="Field padding" value={f.fieldPadding ?? d.fieldPadding} min={6} max={28} onChange={(v) => patch({ form: { fieldPadding: v } })} />
          <Color label="Field border" value={f.borderColor ?? "#cccccc"} onChange={(v) => patch({ form: { borderColor: v } })} />
          <Color label="Field background" value={f.background ?? "#ffffff"} onChange={(v) => patch({ form: { background: v } })} />
        </div>
      )}

      <button
        type="button"
        onClick={() => onChange({ ...tree, theme: undefined })}
        className="text-[11px] text-zinc-500 underline hover:text-zinc-300"
      >
        Reset to default theme
      </button>
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center justify-between gap-2">
      <span className="text-[11px] text-zinc-400">{label}</span>
      {children}
    </label>
  );
}

function Color({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <Row label={label}>
      <span className="flex items-center gap-1.5">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-6 w-8 cursor-pointer rounded border border-ink-600 bg-transparent p-0"
        />
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-20 rounded border border-ink-600 bg-ink-900 px-1.5 py-0.5 font-mono text-[11px] outline-none focus:border-emerald-500"
        />
      </span>
    </Row>
  );
}

function Num({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
}) {
  return (
    <Row label={label}>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-20 rounded border border-ink-600 bg-ink-900 px-1.5 py-0.5 text-[11px] tabular-nums outline-none focus:border-emerald-500"
      />
    </Row>
  );
}

function Select({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <Row label={label}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-28 rounded border border-ink-600 bg-ink-900 px-1.5 py-0.5 text-[11px] outline-none focus:border-emerald-500"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Row>
  );
}

function Font({ label, value, onChange }: { label: string; value: ThemeFont; onChange: (v: ThemeFont) => void }) {
  return (
    <Select
      label={label}
      value={value}
      options={(Object.keys(THEME_FONT_STACKS) as ThemeFont[]).map((k) => ({
        value: k,
        label: k[0].toUpperCase() + k.slice(1),
      }))}
      onChange={(v) => onChange(v as ThemeFont)}
    />
  );
}
