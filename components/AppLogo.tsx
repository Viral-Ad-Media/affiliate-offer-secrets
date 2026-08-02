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

// `wordmark={false}` is the collapsed-sidebar case: the mark alone still identifies the app and
// doubles as the "go home" target that the text link provides when expanded.
export default function AppLogo({
  wordmark = true,
  markClassName,
  textClassName = "font-heading text-base font-bold text-zinc-100",
}: {
  wordmark?: boolean;
  markClassName?: string;
  textClassName?: string;
}) {
  return (
    <span className="flex items-center gap-2">
      <LogoMark className={markClassName} />
      {/* Three words don't fit the 208px of usable width in the expanded sidebar on one line, so
          the wordmark is allowed to wrap to two — leading-tight keeps that from looking loose. */}
      {wordmark && (
        <span className={`${textClassName} min-w-0 leading-tight`}>
          Affiliate Offer <span className="text-emerald-400">Secrets</span>
        </span>
      )}
    </span>
  );
}
