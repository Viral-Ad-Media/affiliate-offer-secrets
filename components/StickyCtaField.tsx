"use client";

import { stickyCtaOf, type PageBlockTree } from "@/lib/engine/renderPages";
import { Card } from "@/components/ui/card";

/**
 * The sticky offer bar — a slim CTA pinned to the bottom of the published funnel page. Edits
 * PageBlockTree.stickyCta, the ContentWidthField precedent (tree + onChange, lives on the tree so
 * one control covers opt-in / variant / step with no migration). Funnel editors mount this; the
 * blog editor does not — the render shells only emit it for funnel pages.
 *
 * A bar with no button label is treated as OFF (stickyCtaOf returns null), so clearing the label
 * removes it — no separate on/off toggle to keep in step with an empty label.
 */
export default function StickyCtaField({
  tree,
  onChange,
}: {
  tree: PageBlockTree;
  onChange: (tree: PageBlockTree) => void;
}) {
  const bar = stickyCtaOf(tree) ?? { text: "", label: "", href: "" };
  const set = (patch: Partial<typeof bar>) => {
    const next = { ...bar, ...patch };
    // An empty label means "off" — drop the key entirely so the tree stays clean and the render
    // emits nothing, rather than storing a labelless bar.
    if (!next.label.trim() && !next.text.trim() && !next.href.trim()) {
      const { stickyCta, ...rest } = tree as PageBlockTree & { stickyCta?: unknown };
      onChange(rest as PageBlockTree);
      return;
    }
    onChange({ ...tree, stickyCta: next });
  };

  const field =
    "w-full rounded-lg border border-ink-600 bg-ink-900 px-2.5 py-1.5 text-xs outline-none focus:border-emerald-500";

  return (
    <Card as="section" className="space-y-3 p-4">
      <div>
        <h2 className="text-sm font-semibold text-zinc-100">Sticky offer bar</h2>
        <p className="mt-0.5 text-[11px] leading-snug text-zinc-500">
          A slim bar pinned to the bottom of the page with your offer button — lifts conversion on
          mobile. Fill in the button text to turn it on; clear it to remove.
        </p>
      </div>

      <label className="block">
        <span className="mb-1 block text-[11px] text-zinc-500">Message (optional)</span>
        <input
          value={bar.text}
          onChange={(e) => set({ text: e.target.value })}
          maxLength={120}
          placeholder="Limited-time offer — ends soon"
          className={field}
        />
      </label>

      <label className="block">
        <span className="mb-1 block text-[11px] text-zinc-500">Button text</span>
        <input
          value={bar.label}
          onChange={(e) => set({ label: e.target.value })}
          maxLength={60}
          placeholder="Get it now"
          className={field}
        />
      </label>

      <label className="block">
        <span className="mb-1 block text-[11px] text-zinc-500">Where it goes</span>
        <input
          value={bar.href}
          onChange={(e) => set({ href: e.target.value })}
          maxLength={2000}
          placeholder="Leave blank to use your offer link"
          className={field}
        />
        <span className="mt-1 block text-[11px] text-zinc-600">
          Blank uses this funnel&apos;s affiliate link automatically — no need to paste it twice.
        </span>
      </label>

      {/* Exit intent is the other page-level conversion booster, so it shares this card rather
          than a second one people have to find. It rides on the same tree. */}
      <label className="flex items-start gap-2 border-t border-ink-700 pt-3">
        <input
          type="checkbox"
          checked={(tree as { exitIntent?: boolean }).exitIntent === true}
          onChange={(e) => {
            const next = { ...tree } as PageBlockTree & { exitIntent?: boolean };
            if (e.target.checked) next.exitIntent = true;
            else delete next.exitIntent;
            onChange(next);
          }}
          className="mt-0.5"
        />
        <span>
          <span className="block text-sm font-medium text-zinc-100">Show a popup when they try to leave</span>
          <span className="mt-0.5 block text-[11px] leading-snug text-zinc-500">
            Reveals your popup form on desktop when the cursor leaves the page — once per visit. Add
            a form block with <em>popup</em> turned on for it to have something to show.
          </span>
        </span>
      </label>
    </Card>
  );
}
