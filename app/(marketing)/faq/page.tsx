import Link from "next/link";

export const metadata = {
  title: "FAQ — ClickBank Studio",
  description: "Common questions about ClickBank Studio.",
};

const FAQS = [
  {
    q: "What exactly does ClickBank Studio generate for me?",
    a: "For each product you promote, it generates Facebook and TikTok ad copy, a bridge (lead-capture) landing page, a blog article, and email swipes — all grounded in claims taken directly from the vendor's own sales page.",
  },
  {
    q: "Do I need a ClickBank account?",
    a: "Yes — you promote products using your own ClickBank affiliate nickname and hoplinks. ClickBank Studio doesn't create ClickBank accounts or process ClickBank commissions; it only helps you research products and produce campaign assets faster.",
  },
  {
    q: "Does ClickBank Studio hold or spend my ad budget?",
    a: "No. When you connect your Facebook account, ad campaigns are created and billed directly through your own Meta ad account and payment method. The platform is only authorized to create and activate campaigns — it never holds or moves your money.",
  },
  {
    q: "Are ad campaigns launched automatically?",
    a: "No. Every campaign is created in a paused state first, so you can review the budget, targeting, and creative before anything can spend money. Nothing goes live until you explicitly click Activate.",
  },
  {
    q: "What are credits?",
    a: "1 credit ≈ $1 of ad budget you're authorizing the platform to commit on your behalf when you activate a campaign. Credits are only deducted at activation — building and comparing paused drafts is free. See the Pricing page for credit pack pricing.",
  },
  {
    q: "Do I need Meta App Review to connect Facebook?",
    a: "No, not to test it yourself. Facebook apps in Development Mode work immediately for the account that owns the app — you can connect your own Page and ad account and use every feature without waiting on Meta's review process.",
  },
  {
    q: "Is there a free trial?",
    a: "Yes — every new account gets a 30-day free trial with full access to product discovery and campaign generation, no credit card required to start.",
  },
  {
    q: "Is the bridge page content compliant for ad platforms?",
    a: "Generated copy avoids fabricated claims, income promises, and cure language, and includes affiliate disclosures on every landing page and blog page. You're still responsible for reviewing copy against the specific ad platform's current policies before running paid traffic.",
  },
  {
    q: "Can I edit the generated content?",
    a: "Yes — every generated asset (ad copy, pages, blog content, email swipes) is meant as a strong first draft you can review and edit before publishing or launching.",
  },
  {
    q: "What happens to my data if I cancel?",
    a: "Your access fee is one-time and non-recurring, so there's no subscription to cancel. If you'd like your account and data removed, contact us and we'll take care of it.",
  },
];

export default function FaqPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-16 sm:py-20">
      <h1 className="text-3xl font-bold text-zinc-100 sm:text-4xl">
        Frequently asked questions
      </h1>
      <p className="mt-4 text-base text-zinc-400">
        Can't find what you're looking for?{" "}
        <Link href="/contact" className="text-emerald-400 hover:underline">
          Get in touch
        </Link>
        .
      </p>

      <div className="mt-10 divide-y divide-ink-800 border-t border-ink-800">
        {FAQS.map((item) => (
          <div key={item.q} className="py-5">
            <h2 className="font-heading text-base font-semibold text-zinc-100">{item.q}</h2>
            <p className="mt-2 text-sm leading-relaxed text-zinc-400">{item.a}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
