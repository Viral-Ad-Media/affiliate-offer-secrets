import Link from "next/link";

export const metadata = {
  title: "About — Affiliate Studio",
  description: "Why Affiliate Studio exists and how it works.",
};

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-16 sm:py-20">
      <h1 className="text-3xl font-bold text-zinc-100 sm:text-4xl">About Affiliate Studio</h1>
      <p className="mt-4 text-base leading-relaxed text-zinc-400">
        Affiliate Studio is a research and campaign-generation cockpit built for
        affiliate marketers who are tired of the manual grind: scrolling the marketplace for
        products, digging through sales pages for angles, and writing ad copy, landing pages, and
        email swipes by hand for every single offer.
      </p>

      <div className="mt-10 space-y-8">
        <section>
          <h2 className="font-heading text-xl font-semibold text-zinc-100">What it does</h2>
          <p className="mt-2 text-sm leading-relaxed text-zinc-400">
            Point it at a category, and it pulls live ClickBank marketplace data, scores products
            on gravity and earnings potential, and verifies each one against its actual vendor
            sales page. For anything worth promoting, it generates a complete kit — Facebook and
            TikTok ad copy, a bridge (lead-capture) landing page, a blog article, and email
            swipes — grounded entirely in what the vendor's own page actually claims.
          </p>
        </section>

        <section>
          <h2 className="font-heading text-xl font-semibold text-zinc-100">
            Your accounts, your control
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-zinc-400">
            Affiliate Studio never touches your affiliate commissions, and it never holds your ad
            budget. When you connect Facebook, you're authorizing the platform to post and launch
            campaigns on your own Page and your own ad account — Meta bills your ad spend
            directly to you. New ad campaigns are always created paused, so nothing goes live
            until you explicitly confirm it.
          </p>
        </section>

        <section>
          <h2 className="font-heading text-xl font-semibold text-zinc-100">
            Built for affiliates, by an affiliate workflow
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-zinc-400">
            The product exists because the actual bottleneck in affiliate marketing usually isn't
            finding an offer — it's producing enough good creative and copy fast enough to test
            it properly. Affiliate Studio is built to close that specific gap, not to replace your
            judgment about what to promote or how to run it.
          </p>
        </section>
      </div>

      <div className="mt-12 flex flex-wrap gap-3">
        <Link href="/login" className="btn-primary px-5 py-2.5 text-base">
          Start your free trial
        </Link>
        <Link href="/contact" className="btn-ghost px-5 py-2.5 text-base">
          Get in touch
        </Link>
      </div>
    </div>
  );
}
