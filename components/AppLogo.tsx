/**
 * The product identity. Four lockups, one component.
 *
 *   "full"  — "Affiliate Offer Secrets". Login and the 404 page, where the reader may never have
 *             seen the product before and a monogram tells them nothing.
 *   "short" — "AOS". The signed-in app, where the operator already knows what they're in and the
 *             expanded sidebar has ~208px of usable width that three words must wrap over.
 *   false   — "AOS", tighter. The collapsed icon rail, which is ~64px wide.
 *   "mark"  — the AOS monogram TILE, the same drawing as app/icon.svg (copied from it, per that
 *             file's own instruction, so the favicon and the chrome can't drift the way the old
 *             "A"/"C" pair did). The marketing nav uses this by explicit request — only the mark,
 *             no wordmark — with the full name kept in the aria-label so a screen reader still
 *             hears what a sighted visitor is left to infer.
 *
 * The accent falls on the last word in one lockup and the last letter in the others — "Secrets"
 * and the "S" — so they read as the same identity at every length.
 */
export default function AppLogo({
  wordmark = "full",
  textClassName = "font-heading text-base font-bold text-zinc-100",
  markClassName = "h-9 w-9",
}: {
  wordmark?: "full" | "short" | "mark" | false;
  textClassName?: string;
  markClassName?: string;
}) {
  if (wordmark === "mark") {
    return (
      <svg
        viewBox="0 0 64 64"
        className={markClassName}
        role="img"
        aria-label="Affiliate Offer Secrets"
      >
        <rect width="64" height="64" rx="14" fill="#0a0f1a" />
        <g fill="none" stroke="#34d399" strokeWidth="4.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M7 44 L13.5 22 L20 44" />
          <path d="M9.6 37.5 H17.4" />
          <circle cx="32" cy="33" r="9.2" />
          <path d="M56.6 26 C56.6 22.2 51.4 20.6 48 22.4 C44.6 24.2 44.6 29.2 48.4 31 L52.2 32.8 C56 34.6 56 40.6 52.2 42.6 C48.8 44.4 44.4 43.2 43.4 40.2" />
        </g>
      </svg>
    );
  }

  if (wordmark === "full") {
    return (
      // Three words don't fit the expanded sidebar's usable width on one line, so this is allowed
      // to wrap to two — leading-tight keeps that from looking loose.
      <span className={`${textClassName} min-w-0 leading-tight`}>
        Affiliate Offer <span className="text-emerald-400">Secrets</span>
      </span>
    );
  }

  // Never wraps, so it can be tracked out slightly — a three-letter monogram at normal
  // letter-spacing reads as an abbreviation rather than as a mark.
  return (
    <span className={`${textClassName} ${wordmark === "short" ? "tracking-wide" : "tracking-tight"}`}>
      AO<span className="text-emerald-400">S</span>
    </span>
  );
}
