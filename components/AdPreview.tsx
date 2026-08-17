"use client";

import { useState } from "react";
import { Eye, EyeOff, ThumbsUp, MessageCircle, Share2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { META_HEADLINE_RECOMMENDED, META_PRIMARY_TEXT_RECOMMENDED } from "@/lib/adCompliance";

/**
 * What this angle looks like in a Facebook feed.
 *
 * The point is the TRUNCATION, not the chrome. Copy is accepted at any length and then cut in the
 * feed, so an angle whose hook lands at word 40 is a different ad from the one you wrote — and
 * that is invisible in a form field. The cut positions are Meta's own published recommendations
 * (Ads Guide: primary text 50-150, headline 27), read from the source rather than remembered;
 * lib/adCompliance.ts owns the numbers so the preview and the checklist can never disagree.
 *
 * Explicitly an approximation. Real rendering varies by placement, device and viewport, so this
 * says "roughly where it cuts", never "this is the ad". A pixel-accurate mock would be a lie with
 * more effort behind it.
 */
export default function AdPreview({
  headline,
  primaryText,
  description,
  cta,
  imageUrl,
  pageName = "Your Page",
}: {
  headline: string;
  primaryText: string;
  description?: string | null;
  cta?: string | null;
  imageUrl?: string | null;
  pageName?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [open, setOpen] = useState(false);

  const primaryCut = primaryText.length > META_PRIMARY_TEXT_RECOMMENDED;
  const shownPrimary =
    primaryCut && !expanded ? primaryText.slice(0, META_PRIMARY_TEXT_RECOMMENDED).trimEnd() : primaryText;
  const headlineCut = headline.length > META_HEADLINE_RECOMMENDED;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-ink-600 px-2.5 py-1 text-xs text-zinc-400 hover:border-emerald-500/50 hover:text-emerald-300"
      >
        <Eye className="h-3.5 w-3.5" /> Preview in feed
      </button>
    );
  }

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="mb-2 inline-flex items-center gap-1.5 rounded-lg border border-ink-600 px-2.5 py-1 text-xs text-zinc-400 hover:text-zinc-200"
      >
        <EyeOff className="h-3.5 w-3.5" /> Hide preview
      </button>

      {/* Light-on-white on purpose: this is what a visitor sees, not part of the dark app chrome —
          the same reason the WYSIWYG canvas renders its page preview light regardless of theme. */}
      <div className="max-w-[400px] overflow-hidden rounded-xl border border-ink-600 bg-white text-[#1a1a1a] shadow-sm">
        <div className="flex items-center gap-2 p-3">
          <div className="h-9 w-9 shrink-0 rounded-full bg-gray-300" aria-hidden />
          <div className="min-w-0">
            <div className="truncate text-[13px] font-semibold">{pageName}</div>
            <div className="text-[11px] text-gray-500">Sponsored · Paid partnership</div>
          </div>
        </div>

        <p className="whitespace-pre-wrap px-3 pb-2 text-[13px] leading-snug">
          {shownPrimary}
          {primaryCut && !expanded && (
            <>
              …{" "}
              <button
                type="button"
                onClick={() => setExpanded(true)}
                className="font-semibold text-gray-500 hover:underline"
              >
                See more
              </button>
            </>
          )}
        </p>

        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- a data:/Cloudinary URL in a mock
          <img src={imageUrl} alt="" className="block w-full" />
        ) : (
          <div className="flex h-[210px] items-center justify-center bg-gray-100 text-xs text-gray-400">
            No creative generated yet
          </div>
        )}

        <div className="flex items-center justify-between gap-3 bg-[#f0f2f5] px-3 py-2">
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-wide text-gray-500">your-domain.com</div>
            {/* Truncated at Meta's recommendation, with the overflow struck through rather than
                deleted — seeing WHAT gets cut is the useful part. */}
            <div className="truncate text-[13px] font-semibold">
              {headline.slice(0, META_HEADLINE_RECOMMENDED)}
              {headlineCut && (
                <span className="font-normal text-gray-400 line-through">
                  {headline.slice(META_HEADLINE_RECOMMENDED)}
                </span>
              )}
            </div>
            {description ? <div className="truncate text-[11px] text-gray-500">{description}</div> : null}
          </div>
          <span className="shrink-0 rounded bg-gray-200 px-3 py-1.5 text-[12px] font-semibold">
            {cta || "Learn more"}
          </span>
        </div>

        <div className="flex items-center justify-around border-t border-gray-200 py-1.5 text-[12px] text-gray-500">
          <span className="flex items-center gap-1"><ThumbsUp className="h-3.5 w-3.5" /> Like</span>
          <span className="flex items-center gap-1"><MessageCircle className="h-3.5 w-3.5" /> Comment</span>
          <span className="flex items-center gap-1"><Share2 className="h-3.5 w-3.5" /> Share</span>
        </div>
      </div>

      <p className={cn("mt-1.5 text-[11px]", headlineCut || primaryCut ? "text-amber-300" : "text-zinc-600")}>
        {headlineCut || primaryCut
          ? "Struck-through text and “See more” show roughly where the feed cuts your copy."
          : "Approximate — real placement varies by device and surface."}
      </p>
    </div>
  );
}
