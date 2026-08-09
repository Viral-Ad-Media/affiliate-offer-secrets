"use client";

import { X } from "lucide-react";
import {
  keywordsOf,
  MAX_SECONDARY_KEYWORDS,
  type PageBlockTree,
} from "@/lib/engine/renderPages";

/**
 * What query this page is written FOR — planned by the build kit, editable here.
 *
 * Shared by all three editors (funnel opt-in, funnel step, blog post) because the value lives on
 * the TREE, the one field every page kind already has. Same shape as ContentWidthField and
 * PageThemePanel, and it sits beside them behind the ⚙ for the same reason: it describes the page,
 * not a block on it.
 *
 * **It renders nothing on the published page, on purpose.** Emitting `<meta name="keywords">` is a
 * 2009 move — Google dropped it as a ranking signal long ago, and today it mostly announces your
 * targeting to competitors. This exists to steer generation and to be visible while you edit.
 */
export default function KeywordsField({
  tree,
  onChange,
}: {
  tree: PageBlockTree;
  onChange: (next: PageBlockTree) => void;
}) {
  const kw = keywordsOf(tree);
  const primary = kw?.primary ?? "";
  const secondary = kw?.secondary ?? [];

  function set(patch: { primary?: string; secondary?: string[]; intent?: string }) {
    const next = {
      primary: patch.primary ?? primary,
      secondary: patch.secondary ?? secondary,
      ...(patch.intent !== undefined ? { intent: patch.intent } : kw?.intent ? { intent: kw.intent } : {}),
    };
    // Clearing the primary drops the whole object rather than storing an empty one, so a page with
    // no targeting looks in the stored JSON exactly like one saved before this existed.
    if (!next.primary.trim()) {
      const { keywords: _drop, ...rest } = tree;
      onChange(rest as PageBlockTree);
      return;
    }
    onChange({ ...tree, keywords: next });
  }

  return (
    <div className="space-y-2">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Keywords</div>

      <label className="block">
        <span className="mb-1 block text-[11px] text-zinc-500">Primary keyword</span>
        <input
          className="w-full rounded-lg border border-ink-600 bg-ink-800 px-2 py-1.5 text-xs text-zinc-100"
          defaultValue={primary}
          placeholder="what a buyer would type"
          onBlur={(e) => set({ primary: e.target.value })}
        />
      </label>

      {primary.trim() !== "" && (
        <>
          <div className="flex flex-wrap gap-1.5">
            {secondary.map((k, i) => (
              <span
                key={`${k}-${i}`}
                className="inline-flex items-center gap-1 rounded-full border border-ink-600 bg-ink-800 px-2 py-0.5 text-[11px] text-zinc-300"
              >
                {k}
                <button
                  type="button"
                  onClick={() => set({ secondary: secondary.filter((_, j) => j !== i) })}
                  title={`Remove ${k}`}
                  className="text-zinc-500 hover:text-red-300"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
          {secondary.length < MAX_SECONDARY_KEYWORDS && (
            <input
              className="w-full rounded-lg border border-ink-600 bg-ink-800 px-2 py-1.5 text-xs text-zinc-100"
              placeholder="add a related term, press Enter"
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                const v = e.currentTarget.value.trim();
                // Case-insensitive dedupe: "Keto bread" and "keto bread" are one term to a writer,
                // and two chips saying the same thing just eat one of the eight slots.
                if (!v || secondary.some((s) => s.toLowerCase() === v.toLowerCase())) return;
                set({ secondary: [...secondary, v] });
                e.currentTarget.value = "";
              }}
            />
          )}
          <label className="block">
            <span className="mb-1 block text-[11px] text-zinc-500">Search intent</span>
            <select
              className="w-full rounded-lg border border-ink-600 bg-ink-800 px-2 py-1.5 text-xs text-zinc-100"
              value={kw?.intent ?? ""}
              onChange={(e) => set({ intent: e.target.value })}
            >
              <option value="">Not set</option>
              <option value="informational">Informational — they want to understand</option>
              <option value="commercial">Commercial — they're comparing</option>
              <option value="transactional">Transactional — they're ready to buy</option>
            </select>
          </label>
        </>
      )}

      <p className="text-[11px] leading-snug text-zinc-500">
        Steers what the kit writes and what a rewrite targets. Never published — no meta keywords
        tag, which stopped being a ranking signal long ago and only shows competitors your hand.
      </p>
    </div>
  );
}
