/**
 * The product wordmark. Three lockups, one component — and no icon.
 *
 *   "full"  — "Affiliate Offer Secrets". Marketing site and login, where the reader may never have
 *             seen the product before and a monogram tells them nothing.
 *   "short" — "AOS". The signed-in app, where the operator already knows what they're in and the
 *             expanded sidebar has ~208px of usable width that three words must wrap over.
 *   false   — "AOS", tighter. The collapsed icon rail, which is ~64px wide.
 *
 * The tile mark that used to sit beside the text is GONE from every one of these. It still exists
 * as app/icon.svg (now an AOS monogram, not the old single "A") and is what a browser tab and an
 * iOS home screen show — but repeating it next to a wordmark that already says the same thing was
 * just noise in the chrome. If a mark is ever wanted back here, take it from app/icon.svg rather
 * than redrawing one, so the two can't drift the way they did before.
 *
 * The accent falls on the last word in one lockup and the last letter in the others — "Secrets"
 * and the "S" — so they read as the same identity at three different lengths.
 */
export default function AppLogo({
  wordmark = "full",
  textClassName = "font-heading text-base font-bold text-zinc-100",
}: {
  wordmark?: "full" | "short" | false;
  textClassName?: string;
}) {
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
