"use client";

import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

/**
 * Guided overlay tour: a spotlight cut around a real element plus a popover explaining it.
 *
 * The known failure mode of tours like this is coupling to the DOM — they point confidently at
 * nothing the moment a layout changes, and nobody notices because the tour only runs for new
 * users. Three things here are specifically about not doing that:
 *
 * 1. Targets are `data-tour` attributes, not CSS selectors or nth-child paths. Renaming a class
 *    or reordering the sidebar can't break a step; only deleting the attribute can, which is
 *    visible in a grep.
 * 2. A step whose target isn't in the DOM is SKIPPED, not rendered pointing at the origin. The
 *    sidebar collapses, and half these targets vanish on a narrow window — that's normal, not an
 *    error, so the tour just moves on.
 * 3. If nothing at all resolves, the tour closes itself rather than showing an empty spotlight.
 *
 * Everything is measured live (scroll, resize, and the element's own position) because the
 * sidebar animates its width — a rect captured once would be wrong for 200ms after a collapse.
 */

export type TourStep = {
  /** Matches a `data-tour="..."` attribute somewhere in the DOM. */
  target: string;
  title: string;
  body: string;
};

export const TOUR_STEPS: TourStep[] = [
  {
    target: "nav-marketplace",
    title: "Start here: find an offer",
    body: "Browse affiliate marketplaces by category and score. Promoting one queues a full campaign kit — ads, funnel pages, an article and email swipes, all written for that specific product.",
  },
  {
    target: "nav-products",
    title: "The offers you're tracking",
    body: "Everything you've promoted lives here. Open one to see its generated kit: ad angles, creatives, and the pages that go with them.",
  },
  {
    target: "nav-funnels",
    title: "Where leads actually come from",
    body: "Each kit builds an opt-in page. Publish it and it starts collecting email addresses — you can edit the copy, add upsell steps, and split-test two versions against the same URL.",
  },
  {
    target: "nav-ads",
    title: "Launch real ads",
    body: "Ads are built per angle and always created PAUSED, so nothing spends money until you review the budget and destination and press Activate yourself.",
  },
  {
    target: "nav-contacts",
    title: "Your list",
    body: "Every lead a funnel captures lands here. Tag them, export them, or add someone by hand — and Emails turns that list into an automated sequence.",
  },
  {
    target: "credits-chip",
    title: "What things cost",
    body: "Credits cover generation — kits, images, video. Real ad spend is billed by Meta to your own ad account, never through us.",
  },
];

/**
 * The first VISIBLE element with this tour target, not merely the first in the DOM.
 *
 * That distinction is load-bearing and cost me a bug: CreditsChip renders twice — once in the
 * sidebar for mobile, once in the top bar — so querySelector returned the hidden copy, whose
 * getBoundingClientRect is all zeros. The result was a popover pinned to the top-left corner
 * spotlighting nothing. "Present in the DOM" and "on screen" are different questions, and a tour
 * only ever wants the second one. Responsive duplicates like this are normal, so this has to be
 * the default lookup rather than a special case.
 */
function findVisible(target: string): Element | null {
  const all = document.querySelectorAll(`[data-tour="${target}"]`);
  for (const el of Array.from(all)) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return el;
  }
  return null;
}

export default function ProductTour({ autoStart }: { autoStart: boolean }) {
  const [running, setRunning] = useState(autoStart);
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  // Resolve forward from `from` to the first step whose target actually exists.
  const firstPresent = useCallback((from: number) => {
    for (let i = from; i < TOUR_STEPS.length; i++) {
      if (findVisible(TOUR_STEPS[i].target)) return i;
    }
    return -1;
  }, []);

  const finish = useCallback(async () => {
    setRunning(false);
    await createClient().rpc("complete_product_tour");
  }, []);

  // On start, jump to the first step that's actually on screen — on a narrow window the sidebar
  // is hidden and every nav target with it, in which case there's no tour to give.
  useEffect(() => {
    if (!running || !mounted) return;
    const first = firstPresent(0);
    if (first === -1) {
      void finish();
      return;
    }
    setIndex(first);
  }, [running, mounted, firstPresent, finish]);

  // Measure on every frame that could move the target: scroll, resize, and the sidebar's own
  // width transition. Cheap enough at this cadence, and always correct.
  useLayoutEffect(() => {
    if (!running || !mounted) return;
    const step = TOUR_STEPS[index];
    if (!step) return;

    let raf = 0;
    const measure = () => {
      const el = findVisible(step.target);
      setRect(el ? el.getBoundingClientRect() : null);
      raf = requestAnimationFrame(measure);
    };
    raf = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(raf);
  }, [running, mounted, index]);

  const next = useCallback(() => {
    const n = firstPresent(index + 1);
    if (n === -1) void finish();
    else setIndex(n);
  }, [index, firstPresent, finish]);

  const back = useCallback(() => {
    for (let i = index - 1; i >= 0; i--) {
      if (findVisible(TOUR_STEPS[i].target)) return setIndex(i);
    }
  }, [index]);

  useEffect(() => {
    if (!running) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") void finish();
      if (e.key === "ArrowRight" || e.key === "Enter") next();
      if (e.key === "ArrowLeft") back();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [running, next, back, finish]);

  if (!running || !mounted || !rect) return null;

  const step = TOUR_STEPS[index];
  const pad = 6;
  const hole = {
    top: rect.top - pad,
    left: rect.left - pad,
    width: rect.width + pad * 2,
    height: rect.height + pad * 2,
  };

  // Popover to the right of the spotlight where there's room (the sidebar case), otherwise below.
  const room = window.innerWidth - (hole.left + hole.width);
  const side = room > 380 ? "right" : "below";
  const pop =
    side === "right"
      ? { top: Math.min(hole.top, window.innerHeight - 240), left: hole.left + hole.width + 12 }
      : { top: hole.top + hole.height + 12, left: Math.max(12, Math.min(hole.left, window.innerWidth - 372)) };

  const shownIndex = TOUR_STEPS.slice(0, index + 1).filter((s) => findVisible(s.target)).length;
  const shownTotal = TOUR_STEPS.filter((s) => findVisible(s.target)).length;

  return createPortal(
    <div className="fixed inset-0 z-[100]">
      {/* Four panels rather than one box-shadow ring: the cut-out stays crisp at any size and
          each panel catches clicks, so the app underneath can't be interacted with mid-tour. */}
      <div className="absolute inset-x-0 top-0 bg-black/70" style={{ height: Math.max(0, hole.top) }} onClick={finish} />
      <div
        className="absolute inset-x-0 bottom-0 bg-black/70"
        style={{ top: hole.top + hole.height }}
        onClick={finish}
      />
      <div
        className="absolute left-0 bg-black/70"
        style={{ top: hole.top, height: hole.height, width: Math.max(0, hole.left) }}
        onClick={finish}
      />
      <div
        className="absolute right-0 bg-black/70"
        style={{ top: hole.top, height: hole.height, left: hole.left + hole.width }}
        onClick={finish}
      />

      {/* The spotlight ring itself — pointer-events-none so it never eats the highlighted click. */}
      <div
        className="pointer-events-none absolute rounded-lg ring-2 ring-emerald-400"
        style={{ top: hole.top, left: hole.left, width: hole.width, height: hole.height }}
      />

      <div
        className="absolute w-[22rem] rounded-xl border border-ink-700 bg-ink-900 p-4 shadow-2xl"
        style={{ top: pop.top, left: pop.left }}
        role="dialog"
        aria-label={step.title}
      >
        <div className="mb-1 text-[11px] uppercase tracking-wide text-emerald-400">
          Step {shownIndex} of {shownTotal}
        </div>
        <h3 className="text-sm font-semibold text-zinc-100">{step.title}</h3>
        <p className="mt-1.5 text-xs leading-relaxed text-zinc-400">{step.body}</p>

        <div className="mt-4 flex items-center justify-between gap-2">
          <button onClick={finish} className="text-xs text-zinc-500 hover:text-zinc-300">
            Skip tour
          </button>
          <div className="flex items-center gap-2">
            {shownIndex > 1 && (
              <Button onClick={back} variant="outline" className="text-xs">
                Back
              </Button>
            )}
            <Button onClick={next} className="text-xs">
              {shownIndex === shownTotal ? "Done" : "Next"}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
