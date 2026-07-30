"use client";

import { useState } from "react";
import { Search, ChevronDown, ChevronRight } from "lucide-react";
import { MAX_SEO_TITLE, MAX_SEO_DESCRIPTION } from "@/lib/seo";

export type SeoValues = { seo_title: string; seo_description: string; seo_index?: boolean };

// Collapsible per-page SEO panel, shared by the blog post editor, the funnel opt-in editor, and
// the funnel step editor — the values are saved by whichever editor owns it (they ride along in
// that editor's existing PATCH body), so this component holds no fetch logic of its own.
export default function SeoFields({
  values,
  onChange,
  fallbackTitle,
  showIndexToggle = false,
  noteWhenNoindex,
}: {
  values: SeoValues;
  onChange: (next: SeoValues) => void;
  fallbackTitle: string;
  showIndexToggle?: boolean;
  noteWhenNoindex?: string;
}) {
  const [open, setOpen] = useState(false);
  const set = (patch: Partial<SeoValues>) => onChange({ ...values, ...patch });

  return (
    <section className="card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-semibold text-zinc-100 hover:bg-ink-800/50"
      >
        {open ? <ChevronDown className="h-4 w-4 text-zinc-500" /> : <ChevronRight className="h-4 w-4 text-zinc-500" />}
        <Search className="h-4 w-4 text-emerald-400" /> SEO
        <span className="ml-auto text-xs font-normal text-zinc-500">
          {values.seo_title || values.seo_description ? "Custom" : "Using defaults"}
        </span>
      </button>

      {open && (
        <div className="space-y-3 border-t border-ink-800 p-4">
          <div>
            <label className="mb-1 flex items-center justify-between text-xs font-medium text-zinc-400">
              <span>Page title</span>
              <span className="text-zinc-600">
                {values.seo_title.length}/{MAX_SEO_TITLE}
              </span>
            </label>
            <input
              value={values.seo_title}
              maxLength={MAX_SEO_TITLE}
              onChange={(e) => set({ seo_title: e.target.value })}
              placeholder={fallbackTitle || "Defaults to the page's first heading"}
              className="w-full rounded-lg border border-ink-600 bg-ink-900 py-2 px-3 text-sm outline-none placeholder:text-zinc-600 focus:border-emerald-500"
            />
          </div>
          <div>
            <label className="mb-1 flex items-center justify-between text-xs font-medium text-zinc-400">
              <span>Meta description</span>
              <span className="text-zinc-600">
                {values.seo_description.length}/{MAX_SEO_DESCRIPTION}
              </span>
            </label>
            <textarea
              value={values.seo_description}
              maxLength={MAX_SEO_DESCRIPTION}
              rows={2}
              onChange={(e) => set({ seo_description: e.target.value })}
              placeholder="One or two sentences shown under the title in search results and link previews."
              className="w-full resize-y rounded-lg border border-ink-600 bg-ink-900 py-2 px-3 text-sm outline-none placeholder:text-zinc-600 focus:border-emerald-500"
            />
          </div>
          {showIndexToggle && (
            <label className="flex items-center gap-2 text-xs text-zinc-400">
              <input
                type="checkbox"
                checked={values.seo_index !== false}
                onChange={(e) => set({ seo_index: e.target.checked })}
                className="h-3.5 w-3.5 accent-emerald-500"
              />
              Allow search engines to index this page
            </label>
          )}
          {noteWhenNoindex && <p className="text-[11px] text-zinc-500">{noteWhenNoindex}</p>}
        </div>
      )}
    </section>
  );
}
