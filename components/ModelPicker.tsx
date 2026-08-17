"use client";

import { modelsForKind, type MediaKind } from "@/lib/generationModels";

/**
 * A one-off model choice for a single generation.
 *
 * The workspace default (Settings → Integrations) decides what runs when nothing is chosen here,
 * which is why the empty value means "use the workspace default" rather than naming a model: this
 * control must not silently pin a generation to whatever the default happened to be when the page
 * was rendered. Sending no `model` lets the server resolve it at queue time, so changing the
 * default takes effect immediately for anyone who never touched this dropdown.
 *
 * Imports the catalog from lib/generationModels.ts, which is isomorphic — pulling the model list
 * out of an engine module would drag the Gemini/kie.ai clients into the client bundle, which
 * `tsc --noEmit` passes and `next build` fails.
 */
export default function ModelPicker({
  kind,
  value,
  onChange,
  disabled,
  className,
}: {
  kind: MediaKind;
  /** "" = use the workspace default. */
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  className?: string;
}) {
  const options = modelsForKind(kind);
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      aria-label={kind === "image" ? "Image model" : "Video model"}
      title={
        options.find((m) => m.id === value)?.blurb ??
        "Uses this workspace's default model — change it in Settings → Integrations"
      }
      className={
        className ??
        "max-w-[11rem] truncate rounded-lg border border-ink-600 bg-ink-900 px-2 py-1 text-xs text-zinc-300 disabled:opacity-50"
      }
    >
      <option value="">Default model</option>
      {options.map((m) => (
        <option key={m.id} value={m.id}>
          {m.label}
        </option>
      ))}
    </select>
  );
}
