"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { modelsForKind, DEFAULT_MODEL_BY_KIND, type MediaKind } from "@/lib/generationModels";

/**
 * Workspace defaults for image and video generation.
 *
 * Writes through the narrow set_workspace_generation_models RPC — `workspaces` has no client
 * UPDATE policy and must not gain one (the profiles precedent). Reads come from the server page,
 * so this component never queries.
 *
 * Imports the catalog from lib/generationModels.ts, which is isomorphic on purpose: pulling the
 * model list out of an engine module would drag the Gemini/kie.ai clients into this client bundle,
 * which `tsc` passes and `next build` fails.
 */
export default function GenerationModelsPanel({
  initialImage,
  initialVideo,
  initialBudget,
}: {
  initialImage: string | null;
  initialVideo: string | null;
  initialBudget?: number | null;
}) {
  const supabase = createClient();
  const [image, setImage] = useState(initialImage ?? DEFAULT_MODEL_BY_KIND.image);
  const [video, setVideo] = useState(initialVideo ?? DEFAULT_MODEL_BY_KIND.video);
  // "" means no cap (unlimited). Kept as a string so the field can be cleared to unset.
  const [budget, setBudget] = useState(initialBudget != null ? String(initialBudget) : "");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  async function save() {
    setSaving(true);
    setMsg(null);
    const trimmed = budget.trim();
    const cap = trimmed === "" ? null : Math.max(0, Math.floor(Number(trimmed)));
    const [models, budgetRes] = await Promise.all([
      supabase.rpc("set_workspace_generation_models", { p_image_model: image, p_video_model: video }),
      supabase.rpc("set_workspace_generation_budget", { p_cap: cap }),
    ]);
    const error = models.error ?? budgetRes.error;
    setSaving(false);
    setMsg(
      error
        ? { kind: "err", text: error.message }
        : { kind: "ok", text: "Saved — applies to new generations." }
    );
  }

  const field = (kind: MediaKind, value: string, onChange: (v: string) => void) => {
    const options = modelsForKind(kind);
    const selected = options.find((m) => m.id === value);
    return (
      <div>
        <label className="mb-1 block text-sm font-medium text-zinc-300">
          {kind === "image" ? "Image model" : "Video model"}
        </label>
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-lg border border-ink-600 bg-ink-900 px-3 py-2 text-sm text-zinc-100"
        >
          {options.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
        {selected ? <p className="mt-1 text-xs text-zinc-500">{selected.blurb}</p> : null}
      </div>
    );
  };

  return (
    <Card as="section" className="p-4">
      <h2 className="text-lg font-semibold text-zinc-100">Generation models</h2>
      <p className="mt-1 text-sm text-zinc-400">
        Which model writes your images and videos. Applies to every generation in this workspace;
        each Generate button can still override it for one run.
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {field("image", image, setImage)}
        {field("video", video, setVideo)}
      </div>

      {/* Real budget control (0119): a daily ceiling on generation SPEND, denominated in credits.
          The credit balance is the absolute limit; this caps how fast it can be spent — an image
          costs 2 credits, a video 10. Blank = no cap. */}
      <div className="mt-4 border-t border-ink-700 pt-4">
        <label className="block text-sm font-medium text-zinc-300">Daily generation budget</label>
        <div className="mt-1 flex items-center gap-2">
          <input
            type="number"
            min={0}
            step={1}
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
            placeholder="No limit"
            className="w-32 rounded-lg border border-ink-600 bg-ink-900 px-3 py-2 text-sm text-zinc-100"
          />
          <span className="text-sm text-zinc-500">credits / day</span>
        </div>
        <p className="mt-1 text-xs text-zinc-500">
          Caps how many credits AI generation can spend per rolling 24 hours (images 2, videos 10).
          Leave blank for no limit. Your credit balance is still the hard ceiling — this just limits
          the daily burn rate.
        </p>
      </div>

      {/* Stated here rather than discovered from a failed job: video falls over to the other
          provider on a quota/billing failure, images have nowhere to go because kie.ai is the only
          image provider wired up. */}
      <p className="mt-4 rounded-lg border border-ink-700 bg-ink-900/60 p-3 text-xs text-zinc-400">
        If a video model can&apos;t run because its account is out of credit or its key is rejected,
        the other provider is used automatically and the result says which one ran. Image generation
        has no second provider yet, so an image failure stays a failure.
      </p>

      <div className="mt-4 flex items-center gap-3">
        <Button onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
        {msg ? (
          <span className={msg.kind === "ok" ? "text-sm text-emerald-300" : "text-sm text-red-300"}>
            {msg.text}
          </span>
        ) : null}
      </div>
    </Card>
  );
}
