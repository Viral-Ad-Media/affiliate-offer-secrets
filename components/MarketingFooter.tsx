import Link from "next/link";

const COLUMNS = [
  {
    title: "Product",
    links: [
      { href: "/pricing", label: "Pricing" },
      { href: "/faq", label: "FAQ" },
      { href: "/login", label: "Sign in" },
    ],
  },
  {
    title: "Company",
    links: [
      { href: "/about", label: "About" },
      { href: "/contact", label: "Contact" },
    ],
  },
  {
    title: "Legal",
    links: [
      { href: "/terms", label: "Terms of Service" },
      { href: "/privacy", label: "Privacy Policy" },
    ],
  },
];

export default function MarketingFooter() {
  return (
    <footer className="border-t border-ink-700 bg-ink-950">
      <div className="mx-auto max-w-6xl px-4 py-10">
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
          <div>
            <div className="font-heading text-sm font-bold text-zinc-100">
              Affiliate Offer <span className="text-emerald-400">Secrets</span>
            </div>
            <p className="mt-2 text-xs text-zinc-500">
              Product research, campaign generation, funnels, email and ad launches — one workflow
              for affiliate marketers.
            </p>
          </div>
          {COLUMNS.map((col) => (
            <div key={col.title}>
              <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                {col.title}
              </div>
              <ul className="mt-2 space-y-1.5">
                {col.links.map((l) => (
                  <li key={l.href}>
                    <Link href={l.href} className="text-sm text-zinc-400 hover:text-zinc-100">
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-8 border-t border-ink-800 pt-6 text-xs text-zinc-600">
          © {new Date().getFullYear()} Affiliate Offer Secrets. ClickBank is a registered trademark of
          Click Sales, Inc.; Affiliate Offer Secrets is an independent tool and is not affiliated with or
          endorsed by ClickBank.
        </div>
      </div>
    </footer>
  );
}
