import Link from "next/link";

export const metadata = {
  title: "FAQ",
  description: "Common questions about Affiliate Offer Secrets.",
};

const FAQS = [
  {
    q: "What exactly does Affiliate Offer Secrets generate for me?",
    a: "For each product you promote: three distinct Facebook/Instagram ad angles, TikTok scripts, a funnel (an opt-in page you can extend with thank-you, upsell and order steps), a blog article, email swipes and social captions — all grounded in claims taken directly from the vendor's own sales page. You can also generate an ad image or a short-form video for each individual angle and social post.",
  },
  {
    q: "Which affiliate networks are supported?",
    a: "ClickBank and Digistore24. Automated marketplace discovery is ClickBank-only today — pick a category and the engine pulls live gravity and earnings data, scores it and verifies each sales page. For Digistore24 you add products by hand; everything downstream (campaign kits, funnels, ads) then works exactly the same. You paste each product's own affiliate link from your network account, so tracking always credits you — Affiliate Offer Secrets never creates network accounts or touches your commissions.",
  },
  {
    q: "Can I edit the funnel pages, or am I stuck with what the AI wrote?",
    a: "Every page is fully editable on a drag-and-drop canvas: sections, rows and columns, headings, paragraphs, images, bullet and icon lists, buttons, dividers and custom form fields, each with its own font, colour, spacing and border controls. The affiliate disclosure, the hoplink and the lead-capture wiring are the only things you can't edit or delete — they're code-owned so a page can never be published without them.",
  },
  {
    q: "Can I run split tests?",
    a: "Yes. Run several copy variants against the same funnel URL with weighted traffic — visitors get a sticky assignment so they always see the same version — and the panel shows views, leads and a conversion rate per variant. When one wins, promote it in a click and the test ends.",
  },
  {
    q: "Where do the leads my funnel captures go?",
    a: "Into your own contact list inside the app. From there you can tag them, import more from CSV, export everything to any ESP, or enrol them in an email sequence.",
  },
  {
    q: "Can I send email from Affiliate Offer Secrets?",
    a: "Yes — one-off broadcasts and multi-step drip sequences, where each step fires a set number of days after that specific contact opted in. Sending goes through your own Resend, SendGrid, Mailgun or SMTP account, so deliverability and sending limits are yours, not a shared pool. Unsubscribe links are added automatically and can't be edited out. If you'd rather not connect anything, there's also a manual mode that builds the emails and hands them to your own mail client.",
  },
  {
    q: "Can I use my own domain?",
    a: "Yes. Connect a domain you already own (we don't sell domains), point its DNS, and serve funnels from it — several campaigns per domain, each on its own path. One domain can also host your blog, which comes with a public index, SEO-friendly slugs, categories, featured images, RSS and a sitemap.",
  },
  {
    q: "Does Affiliate Offer Secrets hold or spend my ad budget?",
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
    q: "Which social accounts can I post to?",
    a: "Facebook Pages, Instagram (feed posts and Reels) and TikTok — each connected over OAuth to accounts you own. Every post is recorded in a single audit trail alongside your emails and generation costs.",
  },
  {
    q: "Can I track visitors on my funnel pages?",
    a: "Yes — drop in your GA4, Google Tag Manager, Microsoft Clarity or Meta Pixel ID per funnel and it's injected into every page that funnel serves, including split-test variants and later steps. Paste the whole install snippet if that's easier; we extract the ID and render our own version of the tag rather than injecting pasted code.",
  },
  {
    q: "Do I need Meta App Review to connect Facebook?",
    a: "No, not to test it yourself. Facebook apps in Development Mode work immediately for the account that owns the app — you can connect your own Page and ad account and use every feature without waiting on Meta's review process. TikTok and Google have equivalent developer/test modes.",
  },
  {
    q: "Is there a free trial?",
    a: "Yes — every new account gets a 30-day free trial with full access to product discovery and campaign generation, no credit card required to start.",
  },
  {
    q: "Is the generated content compliant for ad platforms?",
    a: "Generated copy avoids fabricated claims, income promises, and cure language, and every funnel page and blog post carries an affiliate disclosure that can't be removed. Products whose own sales pages make claims likely to get ads rejected are flagged during discovery. You're still responsible for reviewing copy against the specific ad platform's current policies before running paid traffic.",
  },
  {
    q: "Can I edit the generated content?",
    a: "Yes — every generated asset (ad copy, funnel pages, blog content, email swipes) is meant as a strong first draft you can review and edit before publishing or launching. Nothing is published until you say so: funnels have an explicit publish toggle, blog posts have draft/published states, and ad campaigns are created paused.",
  },
  {
    q: "Do I get paid for referring other affiliates?",
    a: "Yes — every account gets a referral link. When someone who signs up through it pays the access fee, you earn reward points you can redeem 1:1 as ad credits.",
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
