// The app icon (app/icon.svg) as a component, so the sidebar/nav logo and the browser favicon are
// literally the same mark. Inlined rather than <img src="/icon.svg"> so it inherits the page's own
// rendering (no extra request, no flash before it loads) — keep the two in sync when either
// changes.
function LogoMark({ className = "h-7 w-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" role="img" aria-label="Affiliate Offer Secrets" className={`${className} shrink-0`}>
      <rect width="64" height="64" rx="14" fill="#0a0f1a" />
      <path
        d="M20 46 L32 18 L44 46"
        fill="none"
        stroke="#34d399"
        strokeWidth="7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M25.5 37 H38.5" fill="none" stroke="#34d399" strokeWidth="6" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Three lockups, one component.
 *
 *   "full"  — mark + "Affiliate Offer Secrets". Marketing site and login, where the reader may
 *             never have seen the product before and a monogram would tell them nothing.
 *   "short" — mark + "AOS". The signed-in app, where the operator already knows what they're in
 *             and the expanded sidebar has ~208px of usable width that three words must wrap over.
 *   false   — mark alone. The collapsed icon rail, where it doubles as the "go home" target.
 *
 * The monogram is set in the app's own heading font rather than drawn as glyph paths, deliberately:
 * three letterforms inside a 28px tile are illegible, and hand-drawing them would drift from the
 * favicon (app/icon.svg), which stays the single "A" mark and is the same SVG as LogoMark above.
 * A bespoke drawn AOS glyph is a design pass to do with eyes on it at real sizes, not something to
 * derive blind here.
 *
 * The accent falls on the last word in one and the last letter in the other — "Secrets" and the
 * "S" — so both read as the same identity at two different lengths.
 */
export default function AppLogo({
  wordmark = "full",
  markClassName,
  textClassName = "font-heading text-base font-bold text-zinc-100",
}: {
  wordmark?: "full" | "short" | false;
  markClassName?: string;
  textClassName?: string;
}) {
  return (
    <span className="flex items-center gap-2">
      <LogoMark className={markClassName} />
      {wordmark === "full" && (
        // Three words don't fit the expanded sidebar's usable width on one line, so the wordmark
        // is allowed to wrap to two — leading-tight keeps that from looking loose.
        <span className={`${textClassName} min-w-0 leading-tight`}>
          Affiliate Offer <span className="text-emerald-400">Secrets</span>
        </span>
      )}
      {wordmark === "short" && (
        // Never wraps, so it can be tracked out slightly — a three-letter monogram at normal
        // letter-spacing reads as an abbreviation rather than as a mark.
        <span className={`${textClassName} tracking-wide`}>
          AO<span className="text-emerald-400">S</span>
        </span>
      )}
    </span>
  );
}
