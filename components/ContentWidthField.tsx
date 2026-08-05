"use client";

import {
  DEFAULT_CONTENT_WIDTH,
  MIN_CONTENT_WIDTH,
  MAX_CONTENT_WIDTH,
  contentWidthOf,
  type PageBlockTree,
} from "@/lib/engine/renderPages";

/**
 * How wide the page's content column is allowed to get.
 *
 * Lives on the TREE, not on a per-page column, so the same control works for a funnel opt-in, a
 * split-test variant, a funnel step and a blog post with no schema change — page_copy is the one
 * field all four already have.
 *
 * The published rule is `width: 90%; max-width: <this>px`. The percentage is why there's no
 * separate mobile setting: a narrow screen gets a gutter automatically, and this number only ever
 * decides how wide things are allowed to become on a big display.
 */
export default function ContentWidthField({
  tree,
  onChange,
}: {
  tree: PageBlockTree;
  onChange: (tree: PageBlockTree) => void;
}) {
  const width = contentWidthOf(tree);

  const set = (n: number) =>
    onChange({ ...tree, contentWidth: Math.min(MAX_CONTENT_WIDTH, Math.max(MIN_CONTENT_WIDTH, Math.round(n))) });

  return (
    <section className="card space-y-3 p-4">
      <div>
        <h2 className="text-sm font-semibold text-zinc-100">Content width</h2>
        <p className="mt-0.5 text-[11px] leading-snug text-zinc-500">
          The page fills 90% of the screen, up to this width. Narrow keeps text easy to read; wide
          suits pages built from rows and columns.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <input
          type="range"
          min={MIN_CONTENT_WIDTH}
          max={MAX_CONTENT_WIDTH}
          step={20}
          value={width}
          onChange={(e) => set(Number(e.target.value))}
          className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-ink-700 accent-emerald-500"
        />
        <input
          type="number"
          min={MIN_CONTENT_WIDTH}
          max={MAX_CONTENT_WIDTH}
          value={width}
          onChange={(e) => set(Number(e.target.value))}
          className="w-20 rounded-lg border border-ink-600 bg-ink-900 px-2 py-1 text-xs tabular-nums outline-none focus:border-emerald-500"
        />
        <span className="text-xs text-zinc-500">px</span>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {/* Named presets rather than bare numbers: 680 is the measure this app shipped with for
            two years of pages, so it needs to stay one click away, not be something you have to
            remember. */}
        {[
          { label: "Narrow", px: 680 },
          { label: "Medium", px: 960 },
          { label: "Wide", px: DEFAULT_CONTENT_WIDTH },
          { label: "Full", px: MAX_CONTENT_WIDTH },
        ].map((p) => (
          <button
            key={p.px}
            type="button"
            onClick={() => set(p.px)}
            className={`rounded-full border px-2.5 py-0.5 text-[11px] ${
              width === p.px
                ? "border-emerald-500 bg-emerald-500/15 text-emerald-300"
                : "border-ink-600 text-zinc-400 hover:border-ink-500"
            }`}
          >
            {p.label} · {p.px}
          </button>
        ))}
      </div>
    </section>
  );
}
