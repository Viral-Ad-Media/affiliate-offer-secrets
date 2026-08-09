"use client";

import type { ReactNode } from "react";
import { FileQuestion } from "lucide-react";

/**
 * The two pieces of chrome the funnel map is built from, shared by `FunnelMap` and
 * `SplitTestBranch` so the branch's variant cards and the ordinary step cards can't drift into
 * looking like two different products — the same "shared piece for the fiddly part" split that
 * `WysiwygCanvas` already has with its two editors.
 */

/** Logical viewport the thumbnail renders at, and the card width it is scaled down to. */
const THUMB_PAGE_WIDTH = 1120;
export const NODE_WIDTH = 224; // w-56 — THUMB_PAGE_WIDTH * 0.2, so the scale is exactly 1/5
const THUMB_SCALE = NODE_WIDTH / THUMB_PAGE_WIDTH;

/**
 * A live, inert miniature of a page's STORED html.
 *
 * This is the thing that makes the map read as a map rather than a list: you recognise a page by
 * looking at it, not by reading "2. Upsell". It is the same html the Preview link opens, so what
 * you see here is what is really saved — a step edited but not yet saved shows its last save, and
 * one never saved shows the placeholder rather than a blank white rectangle.
 *
 * **`sandbox=""` is load-bearing, not tidiness.** These pages carry the tenant's Meta Pixel and a
 * lead form posting to the real `/api/public/leads` on this same origin. Rendered as an ordinary
 * document, a map with six thumbnails on it would fire six pixel loads every time someone opened
 * the page they edit from. An empty sandbox runs no scripts and submits no forms — the same
 * guarantee `/preview` relies on. `pointer-events-none` on top of that means a click anywhere on
 * the thumbnail selects the CARD, so the iframe can never swallow the control you aimed at.
 */
export function PageThumb({ html, className = "" }: { html: string | null; className?: string }) {
  if (!html) {
    return (
      <div
        className={`flex h-36 w-full flex-col items-center justify-center gap-1 bg-ink-900 text-zinc-600 ${className}`}
      >
        <FileQuestion className="h-5 w-5" />
        <span className="text-[10px]">Not saved yet</span>
      </div>
    );
  }
  return (
    <div className={`h-36 w-full overflow-hidden bg-white ${className}`}>
      <iframe
        srcDoc={html}
        sandbox=""
        title=""
        aria-hidden
        tabIndex={-1}
        loading="lazy"
        scrolling="no"
        style={{
          width: THUMB_PAGE_WIDTH,
          height: THUMB_PAGE_WIDTH, // square source crop; the card's overflow does the trimming
          transform: `scale(${THUMB_SCALE})`,
          transformOrigin: "top left",
          border: 0,
          pointerEvents: "none",
        }}
      />
    </div>
  );
}

/**
 * One page in the map: a thumbnail, a labelled footer, and actions that appear on hover.
 *
 * Actions are hover/focus-revealed rather than always drawn, so a funnel at rest reads as a row of
 * pages instead of a row of toolbars — but they are real focusable controls, so keyboard use
 * reveals them too rather than leaving them mouse-only.
 */
export function NodeCard({
  badge,
  icon: Icon,
  title,
  subtitle,
  html,
  actions,
  stats,
  selectedTone = "default",
  onOpen,
}: {
  badge: string;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  subtitle?: string;
  html: string | null;
  /** Hover-revealed buttons drawn over the thumbnail. */
  actions?: ReactNode;
  /** A compact line under the title — views/leads, weight, whatever the node has to say. */
  stats?: ReactNode;
  selectedTone?: "default" | "branch";
  /** Clicking the card body opens the editor — the same thing the pencil does, bigger target. */
  onOpen?: () => void;
}) {
  return (
    <div
      className={`group relative w-56 shrink-0 overflow-hidden rounded-xl border bg-ink-800 shadow-sm transition-colors ${
        selectedTone === "branch" ? "border-emerald-500/40" : "border-ink-600"
      } hover:border-emerald-500/60`}
    >
      <div className="relative">
        <PageThumb html={html} />
        {/* Whole-thumbnail click target, under the action buttons in z-order so they still win. */}
        {onOpen && (
          <button
            type="button"
            onClick={onOpen}
            aria-label={`Edit ${title}`}
            className="absolute inset-0 cursor-pointer focus:outline-none focus:ring-2 focus:ring-inset focus:ring-emerald-400"
          />
        )}
        {actions && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 bg-gradient-to-t from-black/70 to-transparent p-2 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
            <div className="pointer-events-auto flex items-center gap-1">{actions}</div>
          </div>
        )}
      </div>

      <div className="border-t border-ink-700 px-2.5 py-2">
        <div className="flex items-center gap-1.5">
          <Icon className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
          <span className="truncate text-[11px] font-semibold uppercase tracking-wide text-zinc-500">{badge}</span>
        </div>
        <div className="mt-0.5 truncate text-sm font-medium text-zinc-100" title={title}>
          {title}
        </div>
        {subtitle && <div className="truncate text-[11px] text-zinc-500">{subtitle}</div>}
        {stats && <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-zinc-500">{stats}</div>}
      </div>
    </div>
  );
}
